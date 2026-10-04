<?php

namespace App\Domain\Hooks\Services;

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Hooks\Codes\HookCodeGenerator;
use App\Domain\Hooks\Codes\HookCodeHasher;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * POST hooks/reserve (story 5): gives an anon device one AVAILABLE unit of a shop item
 * for askida.hooks.reservation_minutes minutes, under the daily caps.
 *
 * One transaction, locks always taken in the same order so parallel calls cannot
 * deadlock:
 * 1. the device's counter row of the Istanbul day (`anon_daily_counters`, created on
 *    first use, then `FOR UPDATE`): parallel reserves of one device run one after the
 *    other, so the per-device caps (2 a day, 1 per shop a day) cannot be overrun;
 * 2. the item row (`FOR UPDATE`): parallel reserves of one item run one after the
 *    other, so the item's `daily_cap` (RESERVED + REDEEMED units of the day) holds;
 * 3. expired reservations of that item are released first (correctness never waits
 *    for the release job), then the oldest AVAILABLE unit is taken with
 *    `FOR UPDATE SKIP LOCKED`.
 * The unit gets a fresh code; a hash collision with another live code of the shop
 * (unique partial index) is retried with a new code inside a savepoint, up to
 * askida.hooks.code_attempts times.
 */
class HookReservationService
{
    public function __construct(
        private readonly HookCodeGenerator $codes,
        private readonly HookCodeHasher $hasher,
        private readonly HookReleaseService $release,
    ) {}

    public function reserve(AnonDevice $device, string $shopId, string $itemId): ReservedHook
    {
        $now = CarbonImmutable::now();
        [$dayStart, $dayEnd] = HookDay::bounds($now);

        return DB::transaction(function () use ($device, $shopId, $itemId, $now, $dayStart, $dayEnd): ReservedHook {
            $shop = Shop::query()->whereKey($shopId)->verified()->first();
            $item = $shop === null ? null : Item::query()->whereKey($itemId)->where('shop_id', $shop->id)->where('active', true)->first();

            if ($shop === null || $item === null) {
                // Unknown, unverified or inactive targets look the same: not found.
                throw ProblemException::make(ProblemCode::NotFound, 404);
            }

            $counter = $this->lockCounter($device->anon_id, HookDay::date($now));

            if ($counter->count >= (int) config('askida.hooks.anon_daily_cap', 2)) {
                throw ProblemException::make(ProblemCode::AnonDailyCap, 409);
            }

            $perShop = $counter->per_shop;

            if (($perShop[$shop->id] ?? 0) >= (int) config('askida.hooks.anon_shop_daily_cap', 1)) {
                throw ProblemException::make(ProblemCode::AnonShopCap, 409);
            }

            $item = Item::query()->whereKey($item->id)->lockForUpdate()->firstOrFail();

            if (! $item->active) {
                throw ProblemException::make(ProblemCode::NotFound, 404);
            }

            $this->release->releaseExpiredFor($shop->id, $item->id, $now);

            if ($this->usedToday($item, $dayStart, $dayEnd) >= $item->daily_cap) {
                throw ProblemException::make(ProblemCode::HookNoneAvailable, 409);
            }

            /** @var Hook|null $hook */
            $hook = Hook::query()
                ->where('shop_id', $shop->id)
                ->where('item_id', $item->id)
                ->where('status', HookStatus::Available->value)
                ->orderBy('created_at')
                ->orderBy('id')
                ->lock('for update skip locked')
                ->first();

            if ($hook === null) {
                throw ProblemException::make(ProblemCode::HookNoneAvailable, 409);
            }

            $expiresAt = $now->addMinutes((int) config('askida.hooks.reservation_minutes', 10));
            $code = $this->assignCode($hook, $device->anon_id, $now, $expiresAt);

            $perShop[$shop->id] = ($perShop[$shop->id] ?? 0) + 1;
            $counter->forceFill(['count' => $counter->count + 1, 'per_shop' => $perShop])->save();

            return new ReservedHook($hook->id, $code, $expiresAt, $shop, $item);
        });
    }

    private function lockCounter(string $anonId, string $day): AnonDailyCounter
    {
        $now = HookReleaseService::stamp(CarbonImmutable::now());

        DB::table('anon_daily_counters')->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'anon_id' => $anonId,
            'day' => $day,
            'count' => 0,
            'per_shop' => '{}',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return AnonDailyCounter::query()
            ->where('anon_id', $anonId)
            ->where('day', $day)
            ->lockForUpdate()
            ->firstOrFail();
    }

    /**
     * Units of the item reserved or redeemed during the day (the item's daily cap).
     */
    private function usedToday(Item $item, CarbonImmutable $dayStart, CarbonImmutable $dayEnd): int
    {
        $from = HookReleaseService::stamp($dayStart);
        $until = HookReleaseService::stamp($dayEnd);

        return Hook::query()
            ->where('item_id', $item->id)
            ->where(function ($query) use ($from, $until): void {
                $query->where(function ($reserved) use ($from, $until): void {
                    $reserved->where('status', HookStatus::Reserved->value)
                        ->where('reserved_at', '>=', $from)
                        ->where('reserved_at', '<', $until);
                })->orWhere(function ($redeemed) use ($from, $until): void {
                    $redeemed->where('status', HookStatus::Redeemed->value)
                        ->where('redeemed_at', '>=', $from)
                        ->where('redeemed_at', '<', $until);
                });
            })
            ->count();
    }

    /**
     * Moves the locked unit to RESERVED with a new code. Each attempt runs in a
     * savepoint so a unique violation (code already live at this shop) leaves the outer
     * transaction usable.
     */
    private function assignCode(Hook $hook, string $anonId, CarbonImmutable $now, CarbonImmutable $expiresAt): string
    {
        $attempts = max(1, (int) config('askida.hooks.code_attempts', 5));

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            $code = $this->codes->generate();
            $hash = $this->hasher->hash($code);

            try {
                $updated = DB::transaction(fn (): int => DB::table('hooks')
                    ->where('id', $hook->id)
                    ->where('status', HookStatus::Available->value)
                    ->update([
                        'status' => HookStatus::Reserved->value,
                        'anon_id' => $anonId,
                        'code_hash' => $hash,
                        'reserved_at' => HookReleaseService::stamp($now),
                        'expires_at' => HookReleaseService::stamp($expiresAt),
                        'updated_at' => HookReleaseService::stamp($now),
                    ]));
            } catch (UniqueConstraintViolationException) {
                continue;
            }

            if ($updated !== 1) {
                throw ProblemException::make(ProblemCode::Conflict, 409);
            }

            return $code;
        }

        throw ProblemException::make(ProblemCode::ServiceUnavailable, 503);
    }
}
