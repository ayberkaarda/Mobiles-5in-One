<?php

namespace App\Domain\Payments\Services;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Services\HookIssuer;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Jobs\SendDonationReceipt;
use App\Domain\Payments\Mail\SettlementMismatchMail;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * The single place that turns a provider payment into a donation state change (callback,
 * webhook job and reconciliation all call settle()).
 *
 * One transaction per call:
 * 1. the donation is loaded by provider token with `SELECT ... FOR UPDATE`, so parallel
 *    calls for one token run one after the other;
 * 2. a donation that is already paid or refunded is final: AlreadyPaid, no provider call;
 * 3. otherwise the payment is re-read from the provider (`retrievePayment`); nothing posted
 *    by a browser or carried by a webhook body is used;
 * 4. success with the exact amount, TRY and our conversation id -> paid, hooks issued
 *    (HookIssuer, qty units), receipt job queued after commit;
 *    failure (same conversation id) -> failed; pending -> unchanged;
 *    any disagreement -> status unchanged, one `payment_mismatches` row per kind (unique
 *    while unresolved), an activity log entry and a finance alert queued after commit.
 *
 * A verified success settles however late it is reported (a lost callback and webhook
 * leave only reconciliation to find it): the donor was charged, so the units are issued.
 * The donor day cap is enforced separately: when the settled payment takes the donor's
 * paid total for that day above the cap, a `donor_cap_exceeded` mismatch goes to finance,
 * who may refund it.
 *
 * The row lock is held while the provider is asked (contract decision): it bounds the
 * provider call to one per token at a time. GatewayUnavailable propagates (the
 * transaction rolls back, nothing changes) so callers can retry.
 */
final class PaymentSettlementService implements SettlesPayments
{
    public const LOG_NAME = 'payments';

    public const KIND_AMOUNT = 'amount_mismatch';

    public const KIND_CURRENCY = 'currency_mismatch';

    public const KIND_CONVERSATION = 'conversation_mismatch';

    public const KIND_PAID_AFTER_FAILURE = 'provider_paid_ours_failed';

    public const KIND_CAP_EXCEEDED = 'donor_cap_exceeded';

    /** Days of the donor cap are Europe/Istanbul calendar days (as at checkout). */
    public const CAP_TIMEZONE = 'Europe/Istanbul';

    public const KIND_NO_PAYMENT_ID = 'missing_payment_id';

    public function __construct(
        private readonly PaymentGateway $gateway,
        private readonly HookIssuer $hooks,
    ) {}

    /**
     * @throws GatewayUnavailable
     */
    public function settle(string $providerToken): SettlementOutcome
    {
        if ($providerToken === '') {
            return SettlementOutcome::UnknownToken;
        }

        return DB::transaction(function () use ($providerToken): SettlementOutcome {
            /** @var Donation|null $donation */
            $donation = Donation::query()->where('provider_token', $providerToken)->lockForUpdate()->first();

            if ($donation === null) {
                return SettlementOutcome::UnknownToken;
            }

            if (in_array($donation->status, [DonationStatus::Paid, DonationStatus::Refunded], true)) {
                return SettlementOutcome::AlreadyPaid;
            }

            $payment = $this->gateway->retrievePayment($providerToken);

            return match ($payment->status) {
                ProviderPaymentStatus::Pending => SettlementOutcome::Pending,
                ProviderPaymentStatus::Failure => $this->failure($donation, $payment),
                ProviderPaymentStatus::Success => $this->success($donation, $payment),
            };
        });
    }

    private function success(Donation $donation, ProviderPayment $payment): SettlementOutcome
    {
        $kinds = [];

        if ($donation->status === DonationStatus::Failed) {
            $kinds[] = self::KIND_PAID_AFTER_FAILURE;
        }

        if (! $this->sameConversation($donation, $payment)) {
            $kinds[] = self::KIND_CONVERSATION;
        }

        // The provider payment id is what a refund needs; never mark paid without it.
        if ($payment->providerPaymentId === null || $payment->providerPaymentId === '') {
            $kinds[] = self::KIND_NO_PAYMENT_ID;
        }

        if ($payment->paidAmountMinor !== $donation->amount_minor) {
            $kinds[] = self::KIND_AMOUNT;
        }

        if ($payment->currency !== 'TRY' || $donation->currency !== 'TRY') {
            $kinds[] = self::KIND_CURRENCY;
        }

        if ($kinds !== []) {
            $this->recordMismatches($donation, $payment, $kinds);

            return SettlementOutcome::Mismatch;
        }

        $donation->forceFill([
            'status' => DonationStatus::Paid,
            'paid_at' => CarbonImmutable::now(),
            'provider_payment_id' => $payment->providerPaymentId,
        ])->save();

        $this->hooks->issueForDonation($donation);

        SendDonationReceipt::dispatch($donation->id)->afterCommit();

        if ($this->exceedsDonorDayCap($donation)) {
            $this->recordMismatches($donation, $payment, [self::KIND_CAP_EXCEEDED]);
        }

        return SettlementOutcome::Paid;
    }

    private function failure(Donation $donation, ProviderPayment $payment): SettlementOutcome
    {
        if (! $this->sameConversation($donation, $payment)) {
            $this->recordMismatches($donation, $payment, [self::KIND_CONVERSATION]);

            return SettlementOutcome::Mismatch;
        }

        if ($donation->status === DonationStatus::Initiated) {
            $donation->forceFill(['status' => DonationStatus::Failed])->save();
        }

        return SettlementOutcome::Failed;
    }

    /**
     * The donor's paid donations created on the Istanbul day of this one (the same count
     * the checkout cap uses for paid donations) above `payments.caps.donor_day_minor`.
     */
    private function exceedsDonorDayCap(Donation $donation): bool
    {
        if ($donation->donor_id === null || $donation->created_at === null) {
            return false;
        }

        $start = $donation->created_at->setTimezone(self::CAP_TIMEZONE)->startOfDay();
        $format = 'Y-m-d H:i:s.uP';

        $paid = (int) Donation::query()
            ->where('donor_id', $donation->donor_id)
            ->where('status', DonationStatus::Paid->value)
            ->where('created_at', '>=', $start->format($format))
            ->where('created_at', '<', $start->addDay()->format($format))
            ->sum('amount_minor');

        return $paid > (int) config('payments.caps.donor_day_minor', 500_000);
    }

    private function sameConversation(Donation $donation, ProviderPayment $payment): bool
    {
        return $donation->conversation_id !== null
            && $payment->conversationId !== null
            && hash_equals($donation->conversation_id, $payment->conversationId);
    }

    /**
     * Records each disagreeing kind once while unresolved (partial unique index, insert
     * or ignore), so replays and parallel calls add nothing. Snapshots hold states and
     * amounts only: no token, no conversation id, no personal data.
     *
     * @param  list<string>  $kinds
     */
    private function recordMismatches(Donation $donation, ProviderPayment $payment, array $kinds): void
    {
        $now = CarbonImmutable::now();
        $stamp = $now->format('Y-m-d H:i:s.uP');
        $ours = [
            'status' => $donation->status->value,
            'amount_minor' => $donation->amount_minor,
            'currency' => $donation->currency,
        ];
        $theirs = [
            'status' => $payment->status->value,
            'paid_amount_minor' => $payment->paidAmountMinor,
            'currency' => $payment->currency,
            'conversation_matches' => $this->sameConversation($donation, $payment),
        ];
        $recorded = [];

        foreach ($kinds as $kind) {
            $inserted = DB::table('payment_mismatches')->insertOrIgnore([
                'id' => (string) Str::uuid7(),
                'donation_id' => $donation->id,
                'kind' => $kind,
                'ours' => json_encode($ours, JSON_THROW_ON_ERROR),
                'theirs' => json_encode($theirs, JSON_THROW_ON_ERROR),
                'detected_at' => $stamp,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);

            if ($inserted > 0) {
                $recorded[] = $kind;
            }
        }

        if ($recorded !== []) {
            activity(self::LOG_NAME)
                ->performedOn($donation)
                ->event('payment.mismatch')
                ->withProperties(['donation_id' => $donation->id, 'kinds' => $recorded])
                ->log('payment.mismatch');

            $address = config('payments.finance_alert_email');

            if (is_string($address) && $address !== '') {
                Mail::to($address)->queue(new SettlementMismatchMail($donation->id, $recorded));
            }
        }
    }
}
