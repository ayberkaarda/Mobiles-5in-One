<?php

namespace App\Domain\Hooks\Services;

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Codes\HookCode;
use App\Domain\Hooks\Codes\HookCodeHasher;
use App\Domain\Hooks\Events\HookRedeemed;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * POST shops/{shop}/redeem (story 6, security item 4): validates a code only on the
 * server and moves its unit from RESERVED to REDEEMED exactly once.
 *
 * Inside one transaction the unit is looked up by (shop, HMAC of the code) among live
 * and used codes and locked with `SELECT ... FOR UPDATE`; parallel redeems of one code
 * wait on that lock and then see REDEEMED. Failures are opaque: an unknown code, a used
 * code and a code of another shop all answer `hook.code_invalid`; only a code that
 * matches an expired reservation of this shop answers `hook.code_expired` (and the
 * unit goes back to AVAILABLE on the spot).
 */
class HookRedemptionService
{
    public function __construct(
        private readonly HookCodeHasher $hasher,
        private readonly HookReleaseService $release,
    ) {}

    public function redeem(Shop $shop, User $merchant, #[\SensitiveParameter] string $input): RedeemedHook
    {
        $code = HookCode::normalise($input);

        if (! HookCode::isValid($code)) {
            throw ProblemException::make(ProblemCode::HookCodeInvalid, 422);
        }

        $hash = $this->hasher->hash($code);
        $now = CarbonImmutable::now();

        $result = DB::transaction(function () use ($shop, $merchant, $hash, $now): RedeemedHook|ProblemCode {
            /** @var Hook|null $hook */
            $hook = Hook::query()
                ->where('shop_id', $shop->id)
                ->where('code_hash', $hash)
                ->whereIn('status', [HookStatus::Reserved->value, HookStatus::Redeemed->value])
                ->lockForUpdate()
                ->first();

            if ($hook === null || $hook->status !== HookStatus::Reserved) {
                return ProblemCode::HookCodeInvalid;
            }

            if ($hook->expires_at === null || $hook->expires_at->lessThanOrEqualTo($now)) {
                // The release must commit, so the problem is raised after the transaction.
                $this->release->releaseIfExpired($hook->id, $now);

                return ProblemCode::HookCodeExpired;
            }

            $updated = DB::table('hooks')
                ->where('id', $hook->id)
                ->where('status', HookStatus::Reserved->value)
                ->update([
                    'status' => HookStatus::Redeemed->value,
                    'redeemed_at' => HookReleaseService::stamp($now),
                    'redeemed_by_user_id' => $merchant->id,
                    'updated_at' => HookReleaseService::stamp($now),
                ]);

            if ($updated !== 1) {
                return ProblemCode::HookCodeInvalid;
            }

            $this->flagSelfRedeem($hook, $merchant);

            event(new HookRedeemed($hook->id, $hook->donation_id, $hook->shop_id, $hook->item_id));

            $itemName = Item::query()->whereKey($hook->item_id)->value('name');

            return new RedeemedHook($hook->id, is_string($itemName) ? $itemName : '', $now);
        });

        if ($result instanceof ProblemCode) {
            throw ProblemException::make($result, 422);
        }

        return $result;
    }

    /**
     * A merchant redeeming a unit that the same user paid for is allowed but recorded
     * for finance review (collusion signal). Ids only.
     */
    private function flagSelfRedeem(Hook $hook, User $merchant): void
    {
        $donorId = Donation::query()->whereKey($hook->donation_id)->value('donor_id');

        if ($donorId === null || $donorId !== $merchant->id) {
            return;
        }

        activity('hooks')
            ->event('suspicious_self_redeem')
            ->performedOn($hook)
            ->causedBy($merchant)
            ->withProperties(['shop_id' => $hook->shop_id, 'donation_id' => $hook->donation_id])
            ->log('suspicious_self_redeem');
    }
}
