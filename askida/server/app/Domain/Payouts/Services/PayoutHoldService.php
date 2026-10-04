<?php

namespace App\Domain\Payouts\Services;

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Fraud\Models\AbuseFlagKind;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payouts\Exceptions\PayoutNotHeld;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use InvalidArgumentException;

/**
 * The automatic payout hold (fraud budget). A held payout has `hold = true`, a
 * `hold_reason` and status `held`; the settlement sync never overwrites it. Only finance
 * releases it, with a mandatory reason that goes to the activity log.
 */
final class PayoutHoldService
{
    public const LOG_NAME = 'payouts';

    public const REASON_MAX = 191;

    /**
     * Holds every PENDING payout of the shop. Idempotent: already held, settled and
     * failed payouts are left alone. Returns the number of payouts newly held.
     */
    public function hold(Shop $shop, string $reason): int
    {
        $reason = mb_substr(trim($reason), 0, self::REASON_MAX);

        if ($reason === '') {
            throw new InvalidArgumentException('A hold needs a reason.');
        }

        $count = Payout::query()
            ->where('shop_id', $shop->id)
            ->where('status', PayoutStatus::Pending->value)
            ->where('hold', false)
            ->update([
                'hold' => true,
                'hold_reason' => $reason,
                'status' => PayoutStatus::Held->value,
            ]);

        if ($count > 0) {
            activity(self::LOG_NAME)
                ->performedOn($shop)
                ->event('payout.held')
                ->withProperties(['shop_id' => $shop->id, 'reason' => $reason, 'count' => $count])
                ->log('payout.held');
        }

        return $count;
    }

    /**
     * Finance releases a held payout. It goes back to `pending`; the next settlement sync
     * mirrors the provider state again.
     */
    public function release(Payout $payout, User $finance, string $reason): Payout
    {
        Gate::forUser($finance)->authorize(AdminPermission::HoldPayouts->gate());

        $reason = trim($reason);

        if ($reason === '') {
            throw new InvalidArgumentException('Releasing a hold needs a reason.');
        }

        return DB::transaction(function () use ($payout, $finance, $reason): Payout {
            /** @var Payout $locked */
            $locked = Payout::query()->whereKey($payout->getKey())->lockForUpdate()->firstOrFail();

            if (! $locked->hold && $locked->status !== PayoutStatus::Held) {
                throw new PayoutNotHeld;
            }

            $previous = $locked->hold_reason;

            $locked->forceFill([
                'hold' => false,
                'hold_reason' => null,
                'status' => $locked->status === PayoutStatus::Held ? PayoutStatus::Pending : $locked->status,
            ])->save();

            activity(self::LOG_NAME)
                ->performedOn($locked)
                ->causedBy($finance)
                ->event('payout.released')
                ->withProperties(['shop_id' => $locked->shop_id, 'reason' => $reason, 'previous_reason' => $previous])
                ->log('payout.released');

            return $locked;
        });
    }

    /**
     * The hold reason a newly synced pending payout of the shop must get, or null. A
     * shop with an unreviewed fraud flag keeps new payouts on hold until review.
     */
    public function reasonForNewPayout(Shop $shop): ?string
    {
        $kind = AbuseFlag::query()
            ->where('shop_id', $shop->id)
            ->whereIn('kind', array_map(static fn (AbuseFlagKind $kind): string => $kind->value, AbuseFlagKind::fraudKinds()))
            ->whereNull('reviewed_at')
            ->orderBy('created_at')
            ->value('kind');

        return is_string($kind) ? (AbuseFlagKind::tryFrom($kind)?->holdReason()) : null;
    }
}
