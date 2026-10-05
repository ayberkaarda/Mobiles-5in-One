<?php

namespace App\Domain\Payments\Services;

use App\Domain\Admin\Contracts\RefundsDonations;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Donations\Models\Donation;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Models\User;
use Illuminate\Support\Facades\Gate;
use InvalidArgumentException;

/**
 * The panel's refund of one donation (RefundsDonations), on RefundService.
 *
 * Needs gate `refund-payments` (finance, admin) and a reason. RefundService locks the
 * donation, claims the refund operation and records every failure as a mismatch, so a
 * provider outage does not break the panel: the donation comes back unchanged and the
 * open claim waits for finance to record the provider's outcome.
 */
final class PanelRefunds implements RefundsDonations
{
    public function __construct(private readonly RefundService $refunds) {}

    public function refund(Donation $donation, User $actor, string $reason): Donation
    {
        Gate::forUser($actor)->authorize(AdminPermission::RefundPayments->gate());

        $reason = trim($reason);

        if ($reason === '') {
            throw new InvalidArgumentException('A refund needs a reason.');
        }

        try {
            $this->refunds->refundDonation($donation, $reason, $actor);
        } catch (GatewayUnavailable) {
            // Recorded by RefundService (uncertain claim + refund_failed mismatch).
        }

        return $donation->refresh();
    }
}
