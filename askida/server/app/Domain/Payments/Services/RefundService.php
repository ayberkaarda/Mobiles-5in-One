<?php

namespace App\Domain\Payments\Services;

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Hooks\Services\HookReleaseService;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Mail\DonationRefundedMail;
use App\Domain\Payments\Models\DonationRefund;
use App\Domain\Payments\Models\DonationRefundStatus;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Mail;
use InvalidArgumentException;

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
 * 2. Still under that lock the refund operation is claimed: a `donation_refunds` row in
 *    state `processing` (one row per donation, unique). Only the caller that claimed it
 *    calls the provider. A second caller that finds the claim `processing` or
 *    `uncertain` makes no provider call (Unresolved): the provider's refund call is not
 *    idempotent (the conversation id only correlates), so a second call could refund twice.
 * 3. The provider refund for the unredeemed units (unit price x units), outside the lock.
 * 4. A confirmed refund of the exact amount completes the claim and moves the donation to
 *    `refunded` (again under the lock) and queues the donor notice. A refusal marks the
 *    claim `failed` (no money moved; a later call may claim it again). An outage or a
 *    confirmed refund of another amount marks it `uncertain`: money may have moved, so
 *    nothing retries it until finance records the provider's outcome
 *    (resolveUnresolved). Each failure records a `refund_failed` mismatch for finance.
 *
 * The completed claim keeps the refunded amount and the refunded share of the commission,
 * so the payout ledger aggregates what the shop and the platform keep after a partial
 * refund. Activity log entries hold ids, unit counts and amounts only.
 */
class RefundService
{
    public const LOG_NAME = 'payments';

    public const NOTE_MAX = 500;

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

            /** @var DonationRefund|null $claim */
            $claim = DonationRefund::query()->where('donation_id', $locked->id)->lockForUpdate()->first();

            if ($claim !== null && $claim->status !== DonationRefundStatus::Failed) {
                // processing: another caller is at the provider (or crashed there);
                // uncertain: money may have moved. succeeded cannot meet a paid donation.
                return $claim->status === DonationRefundStatus::Succeeded ? RefundOutcome::AlreadyRefunded : RefundOutcome::Unresolved;
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

            $amount = intdiv($locked->amount_minor, $locked->qty) * $units;

            if ($locked->provider_payment_id === null || $locked->provider_payment_id === '') {
                return ['donation' => $locked, 'units' => $units, 'amount' => $amount, 'claim' => null];
            }

            $claim ??= new DonationRefund;
            $claim->forceFill([
                'donation_id' => $locked->id,
                'status' => DonationRefundStatus::Processing,
                'units' => $units,
                'amount_minor' => $amount,
                'commission_minor' => self::refundedCommission($locked, $units),
                'attempts' => $claim->exists ? $claim->attempts + 1 : 1,
                'provider_refund_id' => null,
                'claimed_at' => CarbonImmutable::now(),
                'completed_at' => null,
            ])->save();

            return ['donation' => $locked, 'units' => $units, 'amount' => $amount, 'claim' => $claim];
        });

        if ($prepared instanceof RefundOutcome) {
            return $prepared;
        }

        /** @var Donation $locked */
        $locked = $prepared['donation'];
        $units = (int) $prepared['units'];
        $amount = (int) $prepared['amount'];
        /** @var DonationRefund|null $claim */
        $claim = $prepared['claim'];

        if ($claim === null) {
            $this->recordFailure($locked, $units, $amount, null, 'missing_payment_id');

            return RefundOutcome::Failed;
        }

        try {
            $result = $this->gateway->refund(new RefundRequest(
                donationId: $locked->id,
                providerPaymentId: (string) $locked->provider_payment_id,
                amountMinor: $amount,
                currency: $locked->currency,
                idempotencyKey: 'refund:'.$locked->id,
                reason: $reason,
            ));
        } catch (GatewayUnavailable $e) {
            $this->markClaim($claim, DonationRefundStatus::Uncertain);
            $this->recordFailure($locked, $units, $amount, null, 'provider_unavailable');

            throw $e;
        }

        if (! $result->succeeded) {
            $this->markClaim($claim, DonationRefundStatus::Failed);
            $this->recordFailure($locked, $units, $amount, $result, 'refused');

            return RefundOutcome::Failed;
        }

        if ($result->refundedAmountMinor !== $amount) {
            $this->markClaim($claim, DonationRefundStatus::Uncertain);
            $this->recordFailure($locked, $units, $amount, $result, 'amount_differs');

            return RefundOutcome::Failed;
        }

        return DB::transaction(function () use ($locked, $claim, $reason, $actor, $result): RefundOutcome {
            /** @var Donation $current */
            $current = Donation::query()->whereKey($locked->id)->lockForUpdate()->firstOrFail();
            /** @var DonationRefund $held */
            $held = DonationRefund::query()->whereKey($claim->id)->lockForUpdate()->firstOrFail();

            if ($current->status !== DonationStatus::Paid || $held->status !== DonationRefundStatus::Processing) {
                return RefundOutcome::AlreadyRefunded;
            }

            $this->complete($current, $held, $actor, $result->providerRefundId, ['reason' => $reason]);

            return RefundOutcome::Refunded;
        });
    }

    /**
     * True while the donation has a refund claim whose provider outcome is open
     * (`processing` or `uncertain`): finance records it with resolveUnresolved().
     */
    public function hasUnresolved(Donation $donation): bool
    {
        return DonationRefund::query()
            ->where('donation_id', $donation->getKey())
            ->whereIn('status', [DonationRefundStatus::Processing->value, DonationRefundStatus::Uncertain->value])
            ->exists();
    }

    /**
     * Finance records what the provider shows for an open refund claim (provider panel or
     * statement), with a note. Refunded at the provider -> the claim completes and the
     * donation is refunded (as a confirmed refund would). Not refunded -> the claim becomes
     * `failed`, so a later refund call may claim it again. Gate `refund-payments`.
     */
    public function resolveUnresolved(Donation $donation, User $actor, bool $refundedAtProvider, string $note): RefundOutcome
    {
        Gate::forUser($actor)->authorize(AdminPermission::RefundPayments->gate());

        $note = mb_substr(trim($note), 0, self::NOTE_MAX);

        if ($note === '') {
            throw new InvalidArgumentException('Recording a refund outcome needs a note.');
        }

        return DB::transaction(function () use ($donation, $actor, $refundedAtProvider, $note): RefundOutcome {
            /** @var Donation $locked */
            $locked = Donation::query()->whereKey($donation->getKey())->lockForUpdate()->firstOrFail();
            /** @var DonationRefund|null $claim */
            $claim = DonationRefund::query()->where('donation_id', $locked->id)->lockForUpdate()->first();

            if ($claim === null || ! in_array($claim->status, [DonationRefundStatus::Processing, DonationRefundStatus::Uncertain], true)) {
                return $locked->status === DonationStatus::Refunded ? RefundOutcome::AlreadyRefunded : RefundOutcome::NotRefundable;
            }

            if ($refundedAtProvider && $locked->status === DonationStatus::Paid) {
                $this->complete($locked, $claim, $actor, null, ['resolution' => 'refunded_at_provider', 'note' => $note]);

                return RefundOutcome::Refunded;
            }

            $claim->forceFill(['status' => DonationRefundStatus::Failed])->save();
            $this->log($locked, $actor, 'refund.marked_not_refunded', ['units' => $claim->units, 'refund_minor' => $claim->amount_minor, 'note' => $note]);

            return RefundOutcome::Failed;
        });
    }

    /**
     * The commission share that leaves with the refunded units: the platform keeps the
     * commission of the units it still holds (floor), the rest goes back.
     */
    public static function refundedCommission(Donation $donation, int $units): int
    {
        $kept = intdiv($donation->commission_minor * max(0, $donation->qty - $units), max(1, $donation->qty));

        return max(0, $donation->commission_minor - $kept);
    }

    /**
     * Completes a held claim inside the caller's transaction: claim succeeded, donation
     * refunded, activity log, donor notice.
     *
     * @param  array<string, scalar|null>  $properties
     */
    private function complete(Donation $donation, DonationRefund $claim, ?User $actor, ?string $providerRefundId, array $properties): void
    {
        $now = CarbonImmutable::now();

        $claim->forceFill([
            'status' => DonationRefundStatus::Succeeded,
            'provider_refund_id' => $providerRefundId,
            'completed_at' => $now,
        ])->save();

        $donation->forceFill(['status' => DonationStatus::Refunded])->save();

        $this->log($donation, $actor, 'donation.refunded', [
            'units' => $claim->units,
            'refunded_minor' => $claim->amount_minor,
            'refunded_commission_minor' => $claim->commission_minor,
            'provider_refund_id' => $providerRefundId,
            ...$properties,
        ]);

        $donor = $donation->donor_id === null ? null : User::query()->find($donation->donor_id);

        if ($donor instanceof User && $donor->email !== '') {
            $itemName = (string) DB::table('items')->where('id', $donation->item_id)->value('name');
            $shopName = (string) DB::table('shops')->where('id', $donation->shop_id)->value('name');

            Mail::to($donor->email)->queue(new DonationRefundedMail($itemName, $shopName, $claim->units, $claim->amount_minor));
        }
    }

    private function markClaim(DonationRefund $claim, DonationRefundStatus $status): void
    {
        DB::table('donation_refunds')
            ->where('id', $claim->id)
            ->where('status', DonationRefundStatus::Processing->value)
            ->update(['status' => $status->value, 'updated_at' => CarbonImmutable::now()]);
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
