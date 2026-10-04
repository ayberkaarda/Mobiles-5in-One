<?php

namespace App\Domain\Payments\Jobs;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Services\MismatchRegister;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

/**
 * payments.reconcile (daily 04:10 Europe/Istanbul, and `payments:reconcile`).
 *
 * Looks at donations still `initiated` 30 minutes after creation (up to 30 days back, or
 * further with --since) and donations `paid` in the window (default: the last 48 hours), reads each payment from the provider and:
 * - fixes a missed transition by calling the settlement service (the only code that
 *   changes a donation), for example a lost webhook or callback;
 * - records a mismatch when we and the provider still disagree afterwards: provider paid
 *   while ours stays open, amount or currency differ, ours paid while the provider reports
 *   a failed (or still pending) payment.
 *
 * Mismatches are idempotent per (donation, kind) while unresolved; each new one writes an
 * activity log entry and queues a finance alert. A provider outage skips the donation
 * (counted, logged with its id) and the next run retries it. Logs carry ids only.
 */
final class ReconcilePayments implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = 'payments.reconcile';

    public const DEFAULT_WINDOW_HOURS = 48;

    public const INITIATED_GRACE_MINUTES = 30;

    /** Initiated donations are looked at this long, even when the window is shorter, so an outage over the window cannot strand a charged one. */
    public const INITIATED_LOOKBACK_DAYS = 30;

    public int $uniqueFor = 3600;

    public int $timeout = 1800;

    public function __construct(public readonly ?CarbonImmutable $since = null)
    {
        $this->onQueue(ProcessPaymentEvent::QUEUE);
    }

    /**
     * @return array{checked: int, fixed: int, mismatches: int, unavailable: int}
     */
    public function handle(PaymentGateway $gateway, SettlesPayments $settler, MismatchRegister $mismatches): array
    {
        $now = CarbonImmutable::now();
        $since = $this->since ?? $now->subHours(self::DEFAULT_WINDOW_HOURS);
        $initiatedSince = $since->min($now->subDays(self::INITIATED_LOOKBACK_DAYS));
        $summary = ['checked' => 0, 'fixed' => 0, 'mismatches' => 0, 'unavailable' => 0];

        Donation::query()
            ->whereNotNull('provider_token')
            ->where(static function (Builder $query) use ($since, $initiatedSince, $now): void {
                $query->where(static function (Builder $initiated) use ($initiatedSince, $now): void {
                    $initiated->where('status', DonationStatus::Initiated->value)
                        ->where('created_at', '>=', $initiatedSince)
                        ->where('created_at', '<=', $now->subMinutes(self::INITIATED_GRACE_MINUTES));
                })->orWhere(static function (Builder $paid) use ($since): void {
                    $paid->where('status', DonationStatus::Paid->value)
                        ->where('paid_at', '>=', $since);
                });
            })
            ->chunkById(200, function ($donations) use ($gateway, $settler, $mismatches, &$summary): void {
                foreach ($donations as $donation) {
                    /** @var Donation $donation */
                    $summary['checked']++;

                    try {
                        $result = $this->reconcile($donation, $gateway, $settler, $mismatches);
                    } catch (GatewayUnavailable) {
                        $summary['unavailable']++;
                        Log::warning(self::NAME.'.gateway_unavailable', ['donation_id' => $donation->id]);

                        continue;
                    }

                    $summary['fixed'] += $result['fixed'];
                    $summary['mismatches'] += $result['mismatches'];
                }
            });

        Log::info(self::NAME, $summary);

        return $summary;
    }

    /**
     * @return array{fixed: int, mismatches: int}
     */
    private function reconcile(Donation $donation, PaymentGateway $gateway, SettlesPayments $settler, MismatchRegister $mismatches): array
    {
        $token = (string) $donation->provider_token;
        $theirs = $gateway->retrievePayment($token);
        $fixed = 0;
        $created = 0;

        if ($donation->status === DonationStatus::Initiated) {
            if ($theirs->status === ProviderPaymentStatus::Pending) {
                return ['fixed' => 0, 'mismatches' => 0];
            }

            $outcome = $settler->settle($token);
            $donation->refresh();

            if (in_array($outcome, [SettlementOutcome::Paid, SettlementOutcome::Failed], true)
                && $donation->status !== DonationStatus::Initiated) {
                $fixed = 1;
                Log::info(self::NAME.'.fixed', ['donation_id' => $donation->id, 'outcome' => $outcome->value]);
            }

            if ($theirs->status === ProviderPaymentStatus::Success && $donation->status !== DonationStatus::Paid) {
                $created += (int) $mismatches->record($donation, MismatchRegister::PROVIDER_PAID_OURS_OPEN, self::ours($donation), self::theirs($theirs));
            }
        } elseif ($donation->status === DonationStatus::Paid) {
            if ($theirs->status === ProviderPaymentStatus::Failure) {
                $created += (int) $mismatches->record($donation, MismatchRegister::OURS_PAID_PROVIDER_FAILED, self::ours($donation), self::theirs($theirs));
            } elseif ($theirs->status === ProviderPaymentStatus::Pending) {
                $created += (int) $mismatches->record($donation, MismatchRegister::OURS_PAID_PROVIDER_PENDING, self::ours($donation), self::theirs($theirs));
            }
        }

        if ($theirs->status === ProviderPaymentStatus::Success) {
            if ($theirs->paidAmountMinor !== $donation->amount_minor) {
                $created += (int) $mismatches->record($donation, MismatchRegister::AMOUNT_MISMATCH, self::ours($donation), self::theirs($theirs));
            }

            if ($theirs->currency !== $donation->currency) {
                $created += (int) $mismatches->record($donation, MismatchRegister::CURRENCY_MISMATCH, self::ours($donation), self::theirs($theirs));
            }
        }

        return ['fixed' => $fixed, 'mismatches' => $created];
    }

    /**
     * @return array<string, scalar|null>
     */
    private static function ours(Donation $donation): array
    {
        return [
            'status' => $donation->status->value,
            'amount_minor' => $donation->amount_minor,
            'currency' => $donation->currency,
        ];
    }

    /**
     * @return array<string, scalar|null>
     */
    private static function theirs(ProviderPayment $payment): array
    {
        return [
            'status' => $payment->status->value,
            'paid_amount_minor' => $payment->paidAmountMinor,
            'currency' => $payment->currency,
            'provider_payment_id' => $payment->providerPaymentId,
        ];
    }

    public function displayName(): string
    {
        return self::NAME;
    }
}
