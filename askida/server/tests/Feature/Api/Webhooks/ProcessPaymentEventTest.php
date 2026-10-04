<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Jobs\ProcessPaymentEvent;
use App\Domain\Payments\Models\PaymentEvent;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Queue\Jobs\FakeJob;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Tests\Support\RecordingSettler;

/*
| ProcessPaymentEvent: hands the named payment to the settlement service, marks the event
| processed, tolerates unknown tokens, backs off while the provider is unavailable and
| never changes a donation by itself.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->settler = new RecordingSettler;
    $this->app->instance(SettlesPayments::class, $this->settler);
});

function storedPaymentEvent(): PaymentEvent
{
    return PaymentEvent::factory()->create(['processed_at' => null]);
}

it('settles the payment named by the event and marks the event processed', function (): void {
    $event = storedPaymentEvent();
    $token = 'tok-'.Str::lower(Str::random(16));
    $this->settler->outcomes[$token] = SettlementOutcome::Paid;

    (new ProcessPaymentEvent($event->id, $token))->withFakeQueueInteractions()->handle($this->settler);

    expect($this->settler->calls)->toBe([$token])
        ->and($event->fresh()?->processed_at)->not->toBeNull();
});

it('keeps the first processing time when the same event is handled again', function (): void {
    $event = storedPaymentEvent();
    $token = 'tok-'.Str::lower(Str::random(16));
    $job = new ProcessPaymentEvent($event->id, $token);

    $job->withFakeQueueInteractions()->handle($this->settler);
    $first = $event->fresh()?->processed_at;
    $this->travel(5)->minutes();
    (new ProcessPaymentEvent($event->id, $token))->withFakeQueueInteractions()->handle($this->settler);

    expect($event->fresh()?->processed_at?->equalTo($first))->toBeTrue()
        ->and($this->settler->calls)->toHaveCount(2);
});

it('tolerates an unknown token and logs the event id only', function (): void {
    $event = storedPaymentEvent();
    $token = 'tok-unknown-'.Str::lower(Str::random(16));
    $this->settler->outcomes[$token] = SettlementOutcome::UnknownToken;
    Log::spy();

    (new ProcessPaymentEvent($event->id, $token))->withFakeQueueInteractions()->handle($this->settler);

    expect($event->fresh()?->processed_at)->not->toBeNull();

    Log::shouldHaveReceived('warning')->withArgs(
        fn (string $message, array $context = []): bool => $message === 'payments.event.unknown_token'
            && $context === ['payment_event_id' => $event->id],
    )->once();
    Log::shouldNotHaveReceived('warning', fn (string $message, array $context = []): bool => str_contains($message.json_encode($context), $token));
    Log::shouldNotHaveReceived('info', fn (string $message, array $context = []): bool => str_contains($message.json_encode($context), $token));
});

it('releases the job with backoff while the provider is unavailable', function (): void {
    $event = storedPaymentEvent();
    $token = 'tok-'.Str::lower(Str::random(16));
    $this->settler->outcomes[$token] = new GatewayUnavailable;

    $job = (new ProcessPaymentEvent($event->id, $token))->withFakeQueueInteractions();
    $job->handle($this->settler);

    $job->assertReleased(ProcessPaymentEvent::BACKOFF[0]);
    expect($event->fresh()?->processed_at)->toBeNull();
});

it('fails the job after the last attempt while the provider stays unavailable', function (): void {
    $event = storedPaymentEvent();
    $token = 'tok-'.Str::lower(Str::random(16));
    $this->settler->outcomes[$token] = new GatewayUnavailable;

    $job = new ProcessPaymentEvent($event->id, $token);
    $fakeJob = new FakeJob;
    $fakeJob->attempts = $job->tries;
    $job->setJob($fakeJob);
    $job->handle($this->settler);

    expect($fakeJob->isReleased())->toBeFalse()
        ->and($fakeJob->hasFailed())->toBeTrue()
        ->and($event->fresh()?->processed_at)->toBeNull();
});

it('never changes the donation itself', function (): void {
    $token = 'tok-'.Str::lower(Str::random(16));
    $donation = Donation::factory()->create(['provider_token' => $token]);
    $this->settler->outcomes[$token] = SettlementOutcome::Paid;

    (new ProcessPaymentEvent(storedPaymentEvent()->id, $token))->withFakeQueueInteractions()->handle($this->settler);

    expect($donation->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and($donation->fresh()?->paid_at)->toBeNull()
        ->and($donation->hooks()->count())->toBe(0);
});

it('runs on the payments queue with an encrypted payload of ids only', function (): void {
    $job = new ProcessPaymentEvent((string) Str::uuid7(), 'tok-'.Str::lower(Str::random(16)));
    $names = array_map(
        static fn (ReflectionProperty $property): string => $property->getName(),
        array_values(array_filter(
            (new ReflectionClass($job))->getProperties(ReflectionProperty::IS_PUBLIC),
            static fn (ReflectionProperty $property): bool => $property->isReadOnly(),
        )),
    );

    expect($job)->toBeInstanceOf(ShouldQueue::class)
        ->and($job)->toBeInstanceOf(ShouldBeEncrypted::class)
        ->and($job->queue)->toBe('payments')
        ->and($names)->toBe(['paymentEventId', 'providerToken']);
});
