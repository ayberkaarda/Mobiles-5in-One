<?php

namespace App\Domain\Payouts\Services;

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payouts\Exceptions\PayoutNotHoldable;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use InvalidArgumentException;

/**
 * The panel's hold and release of one payout (HoldsPayouts), on the payouts domain.
 *
 * Both need gate `manage-payouts` (finance, admin) and a non-empty reason, and run in a
 * transaction with the payout row locked. A manual hold applies to a pending payout only
 * (status `held`, `hold_reason` = "manual: <reason>"); holding a held payout changes
 * nothing. Release is PayoutHoldService::release (back to pending, reason logged). The
 * settlement sync never overwrites a held payout.
 */
final class PanelPayoutHolds implements HoldsPayouts
{
    public const MANUAL_PREFIX = 'manual: ';

    public function __construct(private readonly PayoutHoldService $holds) {}

    public function hold(Payout $payout, User $actor, string $reason): Payout
    {
        Gate::forUser($actor)->authorize(AdminPermission::HoldPayouts->gate());

        $reason = trim($reason);

        if ($reason === '') {
            throw new InvalidArgumentException('A hold needs a reason.');
        }

        return DB::transaction(function () use ($payout, $actor, $reason): Payout {
            /** @var Payout $locked */
            $locked = Payout::query()->whereKey($payout->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->hold || $locked->status === PayoutStatus::Held) {
                return $locked;
            }

            if ($locked->status !== PayoutStatus::Pending) {
                throw new PayoutNotHoldable;
            }

            $stored = mb_substr(self::MANUAL_PREFIX.$reason, 0, PayoutHoldService::REASON_MAX);

            $locked->forceFill([
                'hold' => true,
                'hold_reason' => $stored,
                'status' => PayoutStatus::Held,
            ])->save();

            activity(PayoutHoldService::LOG_NAME)
                ->performedOn($locked)
                ->causedBy($actor)
                ->event('payout.held')
                ->withProperties(['shop_id' => $locked->shop_id, 'reason' => $stored, 'count' => 1])
                ->log('payout.held');

            return $locked;
        });
    }

    public function release(Payout $payout, User $actor, string $reason): Payout
    {
        return $this->holds->release($payout, $actor, $reason);
    }
}
