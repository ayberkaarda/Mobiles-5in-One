<?php

namespace App\Domain\Payments\Jobs;

use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Models\PaymentEvent;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Handles one verified webhook delivery (queue `payments`).
 *
 * The job only asks the settlement service to settle the payment the event names; the
 * service re-reads the payment from the provider and is the only code that changes a
 * donation. The payload holds the `payment_events` id and the provider token, nothing
 * from the event body, and is encrypted on the queue. Logs carry the event id only.
 */
final class ProcessPaymentEvent implements ShouldBeEncrypted, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const QUEUE = 'payments';

    /**
     * Delays in seconds between attempts while the provider is unavailable.
     */
    public const BACKOFF = [30, 60, 120, 300, 600];

    public int $tries = 6;

    public function __construct(
        public readonly string $paymentEventId,
        public readonly string $providerToken,
    ) {
        $this->onQueue(self::QUEUE);
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return self::BACKOFF;
    }

    public function handle(SettlesPayments $settler): void
    {
        try {
            $outcome = $settler->settle($this->providerToken);
        } catch (GatewayUnavailable) {
            $attempt = max(1, $this->attempts());

            if ($attempt >= $this->tries) {
                Log::warning('payments.event.gateway_unavailable_final', ['payment_event_id' => $this->paymentEventId]);
                $this->fail();

                return;
            }

            Log::info('payments.event.gateway_unavailable', ['payment_event_id' => $this->paymentEventId, 'attempt' => $attempt]);
            $this->release(self::BACKOFF[min($attempt, count(self::BACKOFF)) - 1]);

            return;
        }

        if ($outcome === SettlementOutcome::UnknownToken) {
            Log::warning('payments.event.unknown_token', ['payment_event_id' => $this->paymentEventId]);
        }

        PaymentEvent::query()
            ->whereKey($this->paymentEventId)
            ->whereNull('processed_at')
            ->update(['processed_at' => CarbonImmutable::now()->format('Y-m-d H:i:s.uP')]);

        Log::info('payments.event.processed', ['payment_event_id' => $this->paymentEventId, 'outcome' => $outcome->value]);
    }

    public function failed(?Throwable $exception): void
    {
        Log::error('payments.event.failed', ['payment_event_id' => $this->paymentEventId]);
    }

    public function displayName(): string
    {
        return 'payments.process-event';
    }
}
