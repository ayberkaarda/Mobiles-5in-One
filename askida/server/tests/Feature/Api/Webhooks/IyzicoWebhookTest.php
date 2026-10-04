<?php

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Jobs\ProcessPaymentEvent;
use App\Domain\Payments\Models\PaymentEvent;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Support\Testing\Fakes\QueueFake;
use Illuminate\Testing\TestResponse;
use Tests\Support\ScriptedPaymentGateway;

/*
| POST /api/v1/webhooks/iyzico (security item 17): raw-body signature verification,
| stale timestamp rejection, idempotency by event id, fast 200 and a queued job.
| Signatures are computed at run time with a secret made for each test.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    config(['services.iyzico.secret_key' => 'test-'.bin2hex(random_bytes(16))]);
    $this->app->instance(PaymentGateway::class, new ScriptedPaymentGateway);
    Queue::fake();
});

/**
 * @param  array<string, string>  $headers
 */
function deliverWebhook(string $rawBody, array $headers, string $ip = '127.0.0.1'): TestResponse
{
    $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json', 'REMOTE_ADDR' => $ip];

    foreach ($headers as $name => $value) {
        $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
    }

    return test()->call('POST', '/api/v1/webhooks/iyzico', [], [], [], $server, $rawBody);
}

function webhookBody(?string $eventId = null, ?string $token = null): string
{
    return json_encode([
        'event_id' => $eventId ?? 'evt-'.Str::lower(Str::random(12)),
        'event_type' => 'payment.success',
        'token' => $token ?? 'tok-'.Str::lower(Str::random(16)),
        'payment_id' => (string) random_int(100000, 999999),
    ], JSON_THROW_ON_ERROR);
}

function assertRejectedWithoutTrace(TestResponse $response, string $rawBody): void
{
    $response->assertStatus(401)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'auth.token_invalid');

    expect(array_keys($response->json()))->toEqualCanonicalizing(['type', 'title', 'status', 'code', 'request_id']);

    $decoded = json_decode($rawBody, true);

    if (is_array($decoded)) {
        foreach (['event_id', 'token', 'payment_id'] as $field) {
            expect($response->getContent())->not->toContain((string) $decoded[$field]);
        }
    }

    expect(PaymentEvent::query()->count())->toBe(0);
    Queue::assertNothingPushed();
}

it('accepts a correctly signed delivery, records it once and queues the job', function (): void {
    $token = 'tok-'.Str::lower(Str::random(16));
    $body = webhookBody('evt-accept-1', $token);

    deliverWebhook($body, ScriptedPaymentGateway::sign($body))
        ->assertOk()
        ->assertExactJson(['status' => 'accepted']);

    $event = PaymentEvent::query()->sole();

    expect($event->provider)->toBe('iyzico')
        ->and($event->event_id)->toBe('evt-accept-1')
        ->and($event->payload_hash)->toBe(hash('sha256', $body))
        ->and($event->received_at)->not->toBeNull()
        ->and($event->processed_at)->toBeNull();

    Queue::assertPushedOn('payments', ProcessPaymentEvent::class, fn (ProcessPaymentEvent $job): bool => $job->paymentEventId === $event->id && $job->providerToken === $token);
    Queue::assertPushed(ProcessPaymentEvent::class, 1);
});

it('verifies the raw bytes, not a re-encoded body', function (): void {
    // Unusual spacing and key order: re-encoding the decoded JSON would change the bytes
    // and break the signature.
    $body = '{ "token" : "tok-raw-'.Str::lower(Str::random(8))."\",\n  \"event_id\":\"evt-raw-1\" ,\"event_type\":\"payment.success\" }";

    deliverWebhook($body, ScriptedPaymentGateway::sign($body))->assertOk()->assertExactJson(['status' => 'accepted']);

    expect(PaymentEvent::query()->sole()->payload_hash)->toBe(hash('sha256', $body));
});

it('rejects a signature made with another secret', function (): void {
    $body = webhookBody();

    assertRejectedWithoutTrace(deliverWebhook($body, ScriptedPaymentGateway::sign($body, secret: 'other-'.bin2hex(random_bytes(16)))), $body);
});

it('rejects a delivery without signature headers', function (): void {
    $body = webhookBody();

    assertRejectedWithoutTrace(deliverWebhook($body, []), $body);
});

it('rejects a body changed after signing', function (): void {
    $signed = webhookBody('evt-tamper', 'tok-original');
    $tampered = webhookBody('evt-tamper', 'tok-forged');

    assertRejectedWithoutTrace(deliverWebhook($tampered, ScriptedPaymentGateway::sign($signed)), $tampered);
});

it('rejects a correctly signed but stale delivery with the same problem', function (): void {
    $body = webhookBody();
    $old = CarbonImmutable::now()->getTimestamp() - (int) config('payments.webhook_max_age_seconds') - 1;

    assertRejectedWithoutTrace(deliverWebhook($body, ScriptedPaymentGateway::sign($body, $old)), $body);
});

it('accepts a delivery just inside the age window', function (): void {
    $body = webhookBody();
    $edge = CarbonImmutable::now()->getTimestamp() - (int) config('payments.webhook_max_age_seconds') + 5;

    deliverWebhook($body, ScriptedPaymentGateway::sign($body, $edge))->assertOk();
});

it('answers a replayed event as duplicate without processing it again', function (): void {
    $body = webhookBody('evt-replay-1');
    $headers = ScriptedPaymentGateway::sign($body);

    deliverWebhook($body, $headers)->assertOk()->assertExactJson(['status' => 'accepted']);
    PaymentEvent::query()->update(['processed_at' => now()]);
    deliverWebhook($body, $headers)->assertOk()->assertExactJson(['status' => 'duplicate']);

    // A re-signed resend of the same event id (new timestamp, other bytes) is a duplicate too.
    $resend = webhookBody('evt-replay-1');
    deliverWebhook($resend, ScriptedPaymentGateway::sign($resend))->assertOk()->assertExactJson(['status' => 'duplicate']);

    expect(PaymentEvent::query()->count())->toBe(1);
    Queue::assertPushed(ProcessPaymentEvent::class, 1);
});

it('records different events for the same payment separately', function (): void {
    $token = 'tok-'.Str::lower(Str::random(16));

    foreach (['evt-a', 'evt-b'] as $eventId) {
        $body = webhookBody($eventId, $token);
        deliverWebhook($body, ScriptedPaymentGateway::sign($body))->assertOk()->assertExactJson(['status' => 'accepted']);
    }

    expect(PaymentEvent::query()->count())->toBe(2);
    Queue::assertPushed(ProcessPaymentEvent::class, 2);
});

it('needs no bearer token and grants no cross-origin access', function (): void {
    $body = webhookBody();

    $response = deliverWebhook($body, [...ScriptedPaymentGateway::sign($body), 'Origin' => 'https://evil.example.test']);

    $response->assertOk();
    expect($response->headers->has('Access-Control-Allow-Origin'))->toBeFalse();
});

it('limits deliveries to 120 per minute per address', function (): void {
    $body = webhookBody();

    for ($i = 0; $i < 120; $i++) {
        deliverWebhook($body, [], '198.51.100.7')->assertStatus(401);
    }

    deliverWebhook($body, [], '198.51.100.7')
        ->assertStatus(429)
        ->assertJsonPath('code', 'rate_limited')
        ->assertHeader('Retry-After');

    // Another address keeps its own budget.
    deliverWebhook($body, ScriptedPaymentGateway::sign($body), '198.51.100.8')->assertOk();
});

it('queues a retried delivery again when the first dispatch failed, once, and nothing after processing', function (): void {
    $fake = new class($this->app) extends QueueFake
    {
        public bool $failNext = true;

        public function push($job, $data = '', $queue = null)
        {
            if ($this->failNext) {
                $this->failNext = false;

                throw new RuntimeException('queue down');
            }

            return parent::push($job, $data, $queue);
        }
    };
    Queue::swap($fake);

    $body = webhookBody('evt-redispatch-1');
    $headers = ScriptedPaymentGateway::sign($body);

    $this->withoutExceptionHandling();
    expect(fn () => deliverWebhook($body, $headers))->toThrow(RuntimeException::class);
    $fake->assertNothingPushed();
    expect(PaymentEvent::query()->count())->toBe(1);

    deliverWebhook($body, $headers)->assertOk()->assertExactJson(['status' => 'duplicate']);
    $fake->assertPushed(ProcessPaymentEvent::class, 1);

    PaymentEvent::query()->update(['processed_at' => now()]);
    deliverWebhook($body, $headers)->assertOk()->assertExactJson(['status' => 'duplicate']);
    $fake->assertPushed(ProcessPaymentEvent::class, 1);
    expect(PaymentEvent::query()->count())->toBe(1);
});
