<?php

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Jobs\ProcessPaymentEvent;
use App\Domain\Payments\Models\PaymentEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Queue;
use Tests\Support\RecordingSettler;
use Tests\Support\ScriptedPaymentGateway;

/*
| Security items 14 and 17: neither the raw webhook body nor its signature header reaches
| the log, for accepted, rejected and processed deliveries. The marker is made at run time
| and written through the real channel configuration (with the masking tap).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->logPath = storage_path('logs/test-webhook-'.bin2hex(random_bytes(4)).'.log');

    config([
        'logging.default' => 'stack',
        'logging.channels.stack.channels' => ['single'],
        'logging.channels.single.path' => $this->logPath,
        'logging.channels.single.level' => 'debug',
        'services.iyzico.secret_key' => 'test-'.bin2hex(random_bytes(16)),
    ]);
    app('log')->forgetChannel('stack');
    app('log')->forgetChannel('single');

    $this->app->instance(PaymentGateway::class, new ScriptedPaymentGateway);
    Queue::fake();
});

afterEach(function (): void {
    File::delete($this->logPath);
});

/**
 * @param  array<string, string>  $headers
 */
function postWebhookForLog(string $rawBody, array $headers): void
{
    $server = ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'];

    foreach ($headers as $name => $value) {
        $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
    }

    test()->call('POST', '/api/v1/webhooks/iyzico', [], [], [], $server, $rawBody);
}

it('never logs the raw body or the signature of a webhook', function (): void {
    $marker = 'mrk'.bin2hex(random_bytes(8));
    $token = 'tok'.$marker;
    $body = json_encode(['event_id' => 'evt'.$marker, 'event_type' => 'payment.success', 'token' => $token, 'note' => $marker], JSON_THROW_ON_ERROR);
    $valid = ScriptedPaymentGateway::sign($body);
    $forged = [ScriptedPaymentGateway::TIMESTAMP_HEADER => $valid[ScriptedPaymentGateway::TIMESTAMP_HEADER], ScriptedPaymentGateway::SIGNATURE_HEADER => hash('sha256', $marker)];

    postWebhookForLog($body, $valid);
    postWebhookForLog($body, $valid);
    postWebhookForLog($body, $forged);

    // The queued job writes its own lines: the event id, never the token.
    $settler = new RecordingSettler;
    $settler->outcomes[$token] = SettlementOutcome::UnknownToken;
    $this->app->instance(SettlesPayments::class, $settler);
    (new ProcessPaymentEvent(PaymentEvent::query()->sole()->id, $token))->withFakeQueueInteractions()->handle($settler);

    $log = File::exists($this->logPath) ? (string) File::get($this->logPath) : '';

    expect($log)->toMatch('~"route":"api\\\\?/v1\\\\?/webhooks\\\\?/iyzico"~')
        ->and(substr_count($log, 'http.request'))->toBe(3)
        ->and($log)->toContain('payments.event.unknown_token')
        ->and($log)->not->toContain($marker)
        ->and($log)->not->toContain($valid[ScriptedPaymentGateway::SIGNATURE_HEADER])
        ->and($log)->not->toContain($forged[ScriptedPaymentGateway::SIGNATURE_HEADER])
        ->and($log)->not->toContain(hash('sha256', $body));
});
