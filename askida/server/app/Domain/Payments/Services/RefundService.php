<?php

namespace App\Domain\Payments\Services;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Hooks\Services\HookReleaseService;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Mail\DonationRefundedMail;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * Gives back the part of a paid donation that can no longer be delivered: used when a
 * shop is rejected or removed, and by finance from the admin panel.
 *
 * Steps:
 * 1. Under a row lock on the donation: already refunded -> nothing happens; not paid ->
 *    nothing to refund. The donation's AVAILABLE and RESERVED units become EXPIRED in the
 *    same transaction, with every reservation column cleared (anon_id, code_hash,
 *    reserved_at, expires_at), so a held code stops working at once. The units are
 *    locked `FOR UPDATE` first, so a redeem that holds a unit decides it before us and a
 *    redeem that comes later finds no RESERVED unit. REDEEMED units are never touched
 *    (the database trigger would refuse it as well) and are never refunded.
 * 2. The provider refund for the unredeemed units (unit price x units), idempotent per
 *    donation through the idempotency key, outside the database lock.
 * 3. Only a confirmed refund moves the donation to `refunded` (again under the lock, so
 *    concurrent callers transition and mail once) and queues the donor notice. A refusal
 *    or an outage leaves the status as it was and records a `refund_failed` mismatch for
 *    finance; a later call retries with the same idempotency key.
 *
 * Activity log entries hold ids, unit counts and amounts only.
 */
class RefundService
{
    public const LOG_NAME = 'payments';

    private const EXPIRE_OPEN_UNITS = <<<'SQL'
        UPDATE hooks
           SET status = 'EXPIRED', anon_id = NULL, code_hash = NULL, reserved_at = NULL, expires_at = NULL, updated_at = ?
         WHERE status IN ('AVAILABLE', 'RESERVED')
           AND id IN (
                SELECT id FROM hooks
                 WHERE donation_id = ? AND status IN ('AVAILABLE', 'RESERVED')
                 FOR UPDATE)
        SQL;

    public function __construct(
        private readonly PaymentGateway $gateway,
        private readonly MismatchRegister $mismatches,
    ) {}

    public function refundDonation(Donation $donation, string $reason, ?User $actor): RefundOutcome
    {
        $prepared = DB::transaction(function () use ($donation, $actor): array|RefundOutcome {
            /** @var Donation $locked */
            $locked = Donation::query()->whereKey($donation->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status === DonationStatus::Refunded) {
                return RefundOutcome::AlreadyRefunded;
            }

            if ($locked->status !== DonationStatus::Paid) {
                return RefundOutcome::NotRefundable;
            }

            $expired = DB::update(self::EXPIRE_OPEN_UNITS, [
                HookReleaseService::stamp(CarbonImmutable::now()),
                $locked->id,
            ]);

            if ($expired > 0) {
                $this->log($locked, $actor, 'hooks.expired_for_refund', ['units' => $expired]);
            }

            $redeemed = DB::table('hooks')
                ->where('donation_id', $locked->id)
                ->where('status', HookStatus::Redeemed->value)
                ->count();
            $units = max(0, $locked->qty - $redeemed);

            if ($units === 0) {
                return RefundOutcome::NothingToRefund;
            }

            return ['donation' => $locked, 'units' => $units, 'amount' => intdiv($locked->amount_minor, $locked->qty) * $units];
        });

        if ($prepared instanceof RefundOutcome) {
            return $prepared;
        }

        /** @var Donation $locked */
        $locked = $prepared['donation'];
        $units = (int) $prepared['units'];
        $amount = (int) $prepared['amount'];

        if ($locked->provider_payment_id === null || $locked->provider_payment_id === '') {
            $this->recordFailure($locked, $units, $amount, null, 'missing_payment_id');

            return RefundOutcome::Failed;
        }

        try {
            $result = $this->gateway->refund(new RefundRequest(
                donationId: $locked->id,
                providerPaymentId: $locked->provider_payment_id,
                amountMinor: $amount,
                currency: $locked->currency,
                idempotencyKey: 'refund:'.$locked->id,
                reason: $reason,
            ));
        } catch (GatewayUnavailable $e) {
            $this->recordFailure($locked, $units, $amount, null, 'provider_unavailable');

            throw $e;
        }

        if (! $result->succeeded || $result->refundedAmountMinor !== $amount) {
            $this->recordFailure($locked, $units, $amount, $result, $result->succeeded ? 'amount_differs' : 'refused');

            return RefundOutcome::Failed;
        }

        return DB::transaction(function () use ($locked, $units, $amount, $reason, $actor, $result): RefundOutcome {
            /** @var Donation $current */
            $current = Donation::query()->whereKey($locked->id)->lockForUpdate()->firstOrFail();

            if ($current->status !== DonationStatus::Paid) {
                return RefundOutcome::AlreadyRefunded;
            }

            $current->forceFill(['status' => DonationStatus::Refunded])->save();

            $this->log($current, $actor, 'donation.refunded', [
                'units' => $units,
                'refunded_minor' => $amount,
                'reason' => $reason,
                'provider_refund_id' => $result->providerRefundId,
            ]);

            $donor = $current->donor_id === null ? null : User::query()->find($current->donor_id);

            if ($donor instanceof User && $donor->email !== '') {
                $itemName = (string) DB::table('items')->where('id', $current->item_id)->value('name');
                $shopName = (string) DB::table('shops')->where('id', $current->shop_id)->value('name');

                Mail::to($donor->email)->queue(new DonationRefundedMail($itemName, $shopName, $units, $amount));
            }

            return RefundOutcome::Refunded;
        });
    }

    private function recordFailure(Donation $donation, int $units, int $amount, ?RefundResult $result, string $cause): void
    {
        $this->mismatches->record(
            $donation,
            MismatchRegister::REFUND_FAILED,
            ['status' => $donation->status->value, 'refund_minor' => $amount, 'units' => $units, 'cause' => $cause],
            [
                'succeeded' => $result?->succeeded,
                'refunded_minor' => $result?->refundedAmountMinor,
                'provider_refund_id' => $result?->providerRefundId,
            ],
        );
    }

    /**
     * @param  array<string, scalar|null>  $properties
     */
    private function log(Donation $donation, ?User $actor, string $event, array $properties): void
    {
        $entry = activity(self::LOG_NAME)
            ->performedOn($donation)
            ->event($event)
            ->withProperties(['donation_id' => $donation->id, ...$properties]);

        if ($actor !== null) {
            $entry->causedBy($actor);
        }

        $entry->log($event);
    }
}
