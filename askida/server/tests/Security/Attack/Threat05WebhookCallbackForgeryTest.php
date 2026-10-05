<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Payments\Gateways\Iyzico\IyzicoSigner;
use App\Domain\Payments\Jobs\ProcessPaymentEvent;
use App\Domain\Payments\Models\PaymentEvent;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Security\Attack\AttackKit;

/*
| Threat 4.5, webhook and callback forgery. Webhooks are checked against the HMAC over the
| signed fields of the raw body (the real verifier, through the fake gateway, with a secret
| made at run time); a bad, missing or altered signature and a stale event all answer the
| same 401 `auth.token_invalid` and leave no row and no job. A verified event only queues a
| job that re-reads the payment from the provider, so a signed `status=SUCCESS` for a payment
| the provider reports as failed changes nothing. The browser callback reads only the token.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->gateway = PaymentWorld::useFakeGateway();
    PaymentWorld::providerKeys();
    Queue::fake();
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
    $this->donation = PaymentWorld::initiated(PaymentWorld::item(PaymentWorld::payableShop()), qty: 2);
});

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function attack05Payload(Donation $donation, array $overrides = []): array
{
    return array_merge([
        'iyziEventType' => 'CHECKOUT_FORM_AUTH',
        'iyziEventTime' => CarbonImmutable::now()->getTimestampMs(),
        'iyziPaymentId' => (string) random_int(10_000_000, 99_999_999),
        'token' => (string) $donation->provider_token,
        'paymentConversationId' => (string) $donation->conversation_id,
        'status' => 'SUCCESS',
    ], $overrides);
}

/**
 * @param  array<string, mixed>  $payload
 */
function attack05Sign(array $payload, ?string $secret = null): string
{
    return IyzicoSigner::webhookSignature($secret ?? (string) config('services.iyzico.secret_key'), $payload);
}

/**
 * @param  array<string, string>  $headers
 */
function attack05Deliver(string $body, array $headers): TestResponse
{
    return AttackKit::raw('POST', '/api/v1/webhooks/iyzico', $body, $headers);
}

function attack05AssertNothingRecorded(TestResponse $response, Donation $donation): void
{
    AttackKit::assertProblem($response, 401, 'auth.token_invalid');
    expect(array_keys($response->json()))->toEqualCanonicalizing(['type', 'title', 'status', 'code', 'request_id'])
        ->and(PaymentEvent::query()->count())->toBe(0)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(0);
    Queue::assertNothingPushed();
}

function attack05RunQueuedJobs(): void
{
    foreach (Queue::pushed(ProcessPaymentEvent::class) as $job) {
        $job->handle(app(SettlesPayments::class));
    }
}

it('refuses a delivery without a signature, with a foreign key, with an altered signature or an altered body', function (string $case): void {
    $payload = attack05Payload($this->donation);
    $body = json_encode($payload, JSON_THROW_ON_ERROR);
    $valid = attack05Sign($payload);

    [$sentBody, $headers] = match ($case) {
        'missing' => [$body, []],
        'foreign key' => [$body, ['X-Iyz-Signature-V3' => attack05Sign($payload, 'other-'.bin2hex(random_bytes(12)))]],
        'flipped hex' => [$body, ['X-Iyz-Signature-V3' => ($valid[0] === 'a' ? 'b' : 'a').substr($valid, 1)]],
        'body changed after signing' => [json_encode(['status' => 'FAILURE'] + $payload, JSON_THROW_ON_ERROR), ['X-Iyz-Signature-V3' => $valid]],
        'not hex' => [$body, ['X-Iyz-Signature-V3' => str_repeat('z', 64)]],
    };

    attack05AssertNothingRecorded(attack05Deliver($sentBody, $headers), $this->donation);
})->with(['missing', 'foreign key', 'flipped hex', 'body changed after signing', 'not hex']);

it('refuses a correctly signed but stale event with the same answer', function (): void {
    $payload = attack05Payload($this->donation, ['iyziEventTime' => CarbonImmutable::now()->subMinutes(10)->getTimestampMs()]);

    attack05AssertNothingRecorded(
        attack05Deliver(json_encode($payload, JSON_THROW_ON_ERROR), ['X-Iyz-Signature-V3' => attack05Sign($payload)]),
        $this->donation,
    );
});

it('records a replayed delivery once and queues nothing after it was processed', function (): void {
    $this->gateway->scriptPayment((string) $this->donation->provider_token, ProviderPaymentStatus::Success, $this->donation->amount_minor, 'TRY', $this->donation->conversation_id);
    $payload = attack05Payload($this->donation);
    $body = json_encode($payload, JSON_THROW_ON_ERROR);
    $headers = ['X-Iyz-Signature-V3' => attack05Sign($payload)];

    attack05Deliver($body, $headers)->assertOk()->assertExactJson(['status' => 'accepted']);
    Queue::assertPushed(ProcessPaymentEvent::class, 1);
    attack05RunQueuedJobs();

    expect($this->donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(2);

    // The same bytes again, and with the unsigned time moved: same event id, nothing new.
    attack05Deliver($body, $headers)->assertOk()->assertExactJson(['status' => 'duplicate']);
    $moved = ['iyziEventTime' => CarbonImmutable::now()->addSeconds(30)->getTimestampMs()] + $payload;
    attack05Deliver(json_encode($moved, JSON_THROW_ON_ERROR), $headers)->assertOk()->assertExactJson(['status' => 'duplicate']);

    Queue::assertPushed(ProcessPaymentEvent::class, 1);
    expect(PaymentEvent::query()->count())->toBe(1)
        ->and(PaymentEvent::query()->sole()->processed_at)->not->toBeNull()
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(2);
});

it('does not mark a donation paid on a signed SUCCESS event when the provider reports a failure', function (): void {
    $this->gateway->scriptPayment((string) $this->donation->provider_token, ProviderPaymentStatus::Failure, 0, 'TRY', $this->donation->conversation_id);
    $payload = attack05Payload($this->donation, ['status' => 'SUCCESS']);

    attack05Deliver(json_encode($payload, JSON_THROW_ON_ERROR), ['X-Iyz-Signature-V3' => attack05Sign($payload)])
        ->assertOk()->assertExactJson(['status' => 'accepted']);
    attack05RunQueuedJobs();

    expect($this->donation->fresh()?->status)->toBe(DonationStatus::Failed)
        ->and($this->donation->fresh()?->paid_at)->toBeNull()
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(0)
        ->and(PaymentEvent::query()->sole()->processed_at)->not->toBeNull();
});

it('ignores posted status and amount on the browser callback and settles from the provider', function (): void {
    $token = (string) $this->donation->provider_token;
    $this->gateway->scriptPayment($token, ProviderPaymentStatus::Pending, null, 'TRY', $this->donation->conversation_id);

    $forged = $this->post('/pay/callback', [
        'token' => $token,
        'status' => 'success',
        'paidPrice' => '0.01',
        'amount_minor' => 1,
        'paymentStatus' => 'SUCCESS',
    ]);

    $forged->assertOk()->assertSee('askida://donation/'.$this->donation->id.'?status=pending', false);
    expect($this->donation->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(0);

    // Negative control: once the provider reports the full amount, the same callback settles it.
    $this->gateway->scriptPayment($token, ProviderPaymentStatus::Success, $this->donation->amount_minor, 'TRY', $this->donation->conversation_id);
    $this->post('/pay/callback', ['token' => $token, 'amount_minor' => 1])
        ->assertOk()->assertSee('?status=paid', false);

    $paid = $this->donation->fresh();
    expect($paid?->status)->toBe(DonationStatus::Paid)
        ->and($paid?->amount_minor)->toBe($this->donation->amount_minor)
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(2);
});

it('answers a callback without a known token with 404 and changes nothing', function (array $body): void {
    $this->post('/pay/callback', $body)->assertNotFound();

    expect($this->donation->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and(Donation::query()->where('status', DonationStatus::Paid->value)->count())->toBe(0);
})->with([
    'no token' => [['status' => 'success']],
    'unknown token' => [['token' => FakeGateway::tokenFor('not-a-conversation')]],
    'malformed token' => [['token' => '../../etc/passwd']],
    'array token' => [['token' => ['a', 'b']]],
]);
