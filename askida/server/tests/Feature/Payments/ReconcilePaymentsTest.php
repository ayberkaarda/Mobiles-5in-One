<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPayment;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Jobs\ReconcilePayments;
use App\Domain\Payments\Mail\PaymentMismatchAlertMail;
use App\Domain\Payments\Models\PaymentMismatch;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Event as ScheduledEvent;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\RecordingSettler;
use Tests\Support\ScriptedPaymentGateway;

/*
| payments.reconcile (security items 17 and 22): fixes missed transitions through the
| settlement service and records disagreements once per (donation, kind) with an
| activity log entry and a finance alert.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-10-04 04:10:00', 'Europe/Istanbul'));
    config(['payments.finance_alert_email' => 'finance-'.Str::lower(Str::random(6)).'@example.test']);
    Mail::fake();

    $this->gateway = new ScriptedPaymentGateway;
    $this->settler = new RecordingSettler;
    $this->settler->applyTransitions = true;
    $this->app->instance(PaymentGateway::class, $this->gateway);
    $this->app->instance(SettlesPayments::class, $this->settler);
});

/**
 * @param  array<string, mixed>  $attributes
 */
function reconDonation(string $status, CarbonImmutable $createdAt, array $attributes = []): Donation
{
    $factory = Donation::factory();

    if ($status === 'paid') {
        $factory = $factory->paid();
    }

    $donation = $factory->create([
        'provider_token' => 'tok-'.Str::lower(Str::random(20)),
        'status' => $status,
        ...$attributes,
    ]);

    DB::table('donations')->where('id', $donation->id)->update(['created_at' => $createdAt, 'updated_at' => $createdAt]);

    return $donation->refresh();
}

function providerPayment(Donation $donation, ProviderPaymentStatus $status, ?int $amount = null, string $currency = 'TRY'): ProviderPayment
{
    return new ProviderPayment($status, $amount ?? $donation->amount_minor, $currency, 'pay-'.random_int(1000, 9999), null);
}

function runReconcile(?CarbonImmutable $since = null): array
{
    return app()->call([new ReconcilePayments($since), 'handle']);
}

it('fixes an initiated donation that the provider reports as paid', function (): void {
    $donation = reconDonation('initiated', CarbonImmutable::now()->subHours(2));
    $this->gateway->scriptPayment((string) $donation->provider_token, providerPayment($donation, ProviderPaymentStatus::Success));
    $this->settler->outcomes[(string) $donation->provider_token] = SettlementOutcome::Paid;

    $summary = runReconcile();

    expect($this->settler->calls)->toBe([$donation->provider_token])
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and($summary)->toMatchArray(['checked' => 1, 'fixed' => 1, 'mismatches' => 0])
        ->and(PaymentMismatch::query()->count())->toBe(0);

    Mail::assertNothingQueued();
});

it('fixes an initiated donation that the provider reports as failed', function (): void {
    $donation = reconDonation('initiated', CarbonImmutable::now()->subHours(1));
    $this->gateway->scriptPayment((string) $donation->provider_token, providerPayment($donation, ProviderPaymentStatus::Failure, 0));
    $this->settler->outcomes[(string) $donation->provider_token] = SettlementOutcome::Failed;

    expect(runReconcile())->toMatchArray(['fixed' => 1, 'mismatches' => 0])
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Failed);
});

it('leaves initiated donations younger than 30 minutes and pending payments alone', function (): void {
    $young = reconDonation('initiated', CarbonImmutable::now()->subMinutes(29));
    $pending = reconDonation('initiated', CarbonImmutable::now()->subHours(3));
    $this->gateway->scriptPayment((string) $young->provider_token, providerPayment($young, ProviderPaymentStatus::Success));
    $this->gateway->scriptPayment((string) $pending->provider_token, providerPayment($pending, ProviderPaymentStatus::Pending, 0));

    $summary = runReconcile();

    expect($this->gateway->retrieved)->toBe([$pending->provider_token])
        ->and($this->settler->calls)->toBe([])
        ->and($summary)->toMatchArray(['checked' => 1, 'fixed' => 0, 'mismatches' => 0]);
});

it('records provider paid while ours stays open, once, with a log entry and an alert', function (): void {
    $donation = reconDonation('initiated', CarbonImmutable::now()->subHours(2));
    $this->gateway->scriptPayment((string) $donation->provider_token, providerPayment($donation, ProviderPaymentStatus::Success));
    // The settlement service could not settle it (for example it disagrees on the conversation).
    $this->settler->outcomes[(string) $donation->provider_token] = SettlementOutcome::Mismatch;

    $first = runReconcile();
    $second = runReconcile();

    $mismatch = PaymentMismatch::query()->sole();

    expect($first)->toMatchArray(['fixed' => 0, 'mismatches' => 1])
        ->and($second)->toMatchArray(['fixed' => 0, 'mismatches' => 0])
        ->and($mismatch->donation_id)->toBe($donation->id)
        ->and($mismatch->kind)->toBe('provider_paid_ours_open')
        ->and($mismatch->ours)->toMatchArray(['status' => 'initiated', 'amount_minor' => $donation->amount_minor])
        ->and($mismatch->theirs)->toMatchArray(['status' => 'success', 'paid_amount_minor' => $donation->amount_minor])
        ->and($mismatch->resolved_at)->toBeNull()
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Initiated);

    $activity = Activity::query()->where('log_name', 'payments')->where('event', 'payment.mismatch')->sole();
    expect($activity->properties->toArray())->toBe(['donation_id' => $donation->id, 'mismatch_id' => $mismatch->id, 'kind' => 'provider_paid_ours_open']);

    Mail::assertQueued(PaymentMismatchAlertMail::class, 1);
    Mail::assertQueued(PaymentMismatchAlertMail::class, fn (PaymentMismatchAlertMail $mail): bool => $mail->hasTo((string) config('payments.finance_alert_email'))
        && $mail->donationId === $donation->id
        && $mail->kind === 'provider_paid_ours_open');
});

it('records an amount disagreement on a paid donation', function (): void {
    $donation = reconDonation('paid', CarbonImmutable::now()->subHours(5), ['paid_at' => CarbonImmutable::now()->subHours(5)]);
    $this->gateway->scriptPayment((string) $donation->provider_token, providerPayment($donation, ProviderPaymentStatus::Success, $donation->amount_minor - 1));

    expect(runReconcile())->toMatchArray(['mismatches' => 1])
        ->and($this->settler->calls)->toBe([])
        ->and(PaymentMismatch::query()->sole()->kind)->toBe('amount_mismatch')
        ->and(PaymentMismatch::query()->sole()->theirs['paid_amount_minor'])->toBe($donation->amount_minor - 1);
});

it('records ours paid while the provider reports a failure', function (): void {
    $donation = reconDonation('paid', CarbonImmutable::now()->subHours(30), ['paid_at' => CarbonImmutable::now()->subHours(30)]);
    $this->gateway->scriptPayment((string) $donation->provider_token, providerPayment($donation, ProviderPaymentStatus::Failure, 0));

    runReconcile();

    expect(PaymentMismatch::query()->sole()->kind)->toBe('ours_paid_provider_failed')
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid);
    Mail::assertQueued(PaymentMismatchAlertMail::class, 1);
});

it('opens a new mismatch of the same kind once the earlier one is resolved', function (): void {
    $donation = reconDonation('paid', CarbonImmutable::now()->subHours(2), ['paid_at' => CarbonImmutable::now()->subHours(2)]);
    $this->gateway->scriptPayment((string) $donation->provider_token, providerPayment($donation, ProviderPaymentStatus::Failure, 0));

    runReconcile();
    PaymentMismatch::query()->sole()->forceFill(['resolved_at' => now(), 'resolution_note' => 'checked'])->save();
    runReconcile();

    expect(PaymentMismatch::query()->where('kind', 'ours_paid_provider_failed')->count())->toBe(2)
        ->and(PaymentMismatch::query()->whereNull('resolved_at')->count())->toBe(1);
});

it('ignores paid donations outside the window unless --since widens it', function (): void {
    $old = reconDonation('paid', CarbonImmutable::now()->subDays(4), ['paid_at' => CarbonImmutable::now()->subDays(4)]);
    $this->gateway->scriptPayment((string) $old->provider_token, providerPayment($old, ProviderPaymentStatus::Failure, 0));

    expect(runReconcile())->toMatchArray(['checked' => 0]);

    $this->artisan('payments:reconcile', ['--since' => CarbonImmutable::now()->subDays(5)->toDateString()])
        ->expectsOutputToContain('checked 1, fixed 0, new mismatches 1, provider unavailable 0')
        ->assertSuccessful();

    expect(PaymentMismatch::query()->sole()->donation_id)->toBe($old->id);
});

it('skips a donation while the provider is unavailable and carries on', function (): void {
    $down = reconDonation('initiated', CarbonImmutable::now()->subHours(2));
    $up = reconDonation('initiated', CarbonImmutable::now()->subHours(2));
    $this->gateway->scriptPayment((string) $down->provider_token, new GatewayUnavailable);
    $this->gateway->scriptPayment((string) $up->provider_token, providerPayment($up, ProviderPaymentStatus::Success));
    $this->settler->outcomes[(string) $up->provider_token] = SettlementOutcome::Paid;

    expect(runReconcile())->toMatchArray(['checked' => 2, 'fixed' => 1, 'unavailable' => 1])
        ->and($down->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and($up->fresh()?->status)->toBe(DonationStatus::Paid);
});

it('refuses an unparsable or future --since value', function (): void {
    $this->artisan('payments:reconcile', ['--since' => 'not a date'])->assertFailed();
    $this->artisan('payments:reconcile', ['--since' => CarbonImmutable::now()->addDay()->toIso8601String()])->assertFailed();
});

it('is scheduled daily at 04:10 Europe/Istanbul on one server', function (): void {
    $events = array_values(array_filter(
        app(Schedule::class)->events(),
        static fn (ScheduledEvent $event): bool => $event->description === 'payments.reconcile',
    ));

    expect($events)->toHaveCount(1)
        ->and($events[0]->expression)->toBe('10 4 * * *')
        ->and($events[0]->timezone)->toBe('Europe/Istanbul')
        ->and($events[0]->onOneServer)->toBeTrue()
        ->and($events[0]->withoutOverlapping)->toBeTrue();
});

it('writes alert mails with ids and amounts only', function (): void {
    $mail = new PaymentMismatchAlertMail(
        (string) Str::uuid7(),
        (string) Str::uuid7(),
        'amount_mismatch',
        ['status' => 'paid', 'amount_minor' => 1500, 'currency' => 'TRY'],
        ['status' => 'success', 'paid_amount_minor' => 1499, 'currency' => 'TRY', 'provider_payment_id' => 'pay-1'],
        CarbonImmutable::now(),
    );

    $text = $mail->render();

    expect($text)->toContain('amount_mismatch')
        ->and($text)->toContain($mail->donationId)
        ->and($text)->toContain('1499')
        ->and($text)->toContain('Ödeme uyuşmazlığı')
        ->and($text)->toContain('Payment mismatch')
        ->and($text)->not->toContain('@');
});
