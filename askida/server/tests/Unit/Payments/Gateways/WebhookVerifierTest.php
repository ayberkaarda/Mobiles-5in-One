<?php

use App\Domain\Payments\Exceptions\InvalidWebhookSignature;
use App\Domain\Payments\Exceptions\StaleWebhook;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Payments\Gateways\Iyzico\IyzicoSigner;
use App\Domain\Payments\Gateways\IyzicoGateway;
use Carbon\CarbonImmutable;
use Tests\Feature\Api\Donations\Support\PaymentWorld;

/*
| Webhook signature (X-IYZ-SIGNATURE-V3) and age window, shared by both gateways.
| Signatures are computed at run time with a run-time secret.
*/

beforeEach(function (): void {
    PaymentWorld::providerKeys();
    config(['payments.webhook_max_age_seconds' => 300]);
});

/**
 * @param  array<string, mixed>  $overrides
 * @return array{0: string, 1: array<string, string>}
 */
function signedWebhook(array $overrides = [], ?string $secret = null): array
{
    $payload = array_merge([
        'iyziEventType' => 'CHECKOUT_FORM_AUTH',
        'iyziEventTime' => CarbonImmutable::now()->getTimestampMs(),
        'iyziPaymentId' => 9988,
        'token' => 'tok-webhook-1234',
        'paymentConversationId' => 'conv-1',
        'status' => 'SUCCESS',
    ], $overrides);
    $signature = IyzicoSigner::webhookSignature($secret ?? (string) config('services.iyzico.secret_key'), $payload);

    return [json_encode($payload, JSON_THROW_ON_ERROR), ['X-IYZ-SIGNATURE-V3' => [$signature]]];
}

dataset('gateways', [
    'iyzico' => [IyzicoGateway::class],
    'fake' => [FakeGateway::class],
]);

it('accepts a correctly signed, fresh event and names the payment only', function (string $gateway): void {
    [$body, $headers] = signedWebhook();

    $event = app($gateway)->verifyWebhook($body, $headers);

    expect($event->providerToken)->toBe('tok-webhook-1234')
        ->and($event->providerPaymentId)->toBe('9988')
        ->and($event->eventType)->toBe('CHECKOUT_FORM_AUTH')
        ->and($event->eventId)->toBe(app($gateway)->verifyWebhook($body, $headers)->eventId)
        ->and(strlen($event->eventId))->toBe(64);
})->with('gateways');

it('rejects a missing, malformed or wrong signature and a changed body', function (string $gateway, Closure $mutate): void {
    [$body, $headers] = signedWebhook();
    [$body, $headers] = $mutate($body, $headers);

    expect(fn () => app($gateway)->verifyWebhook($body, $headers))->toThrow(InvalidWebhookSignature::class);
})->with('gateways')->with([
    'missing header' => [fn (string $b, array $h): array => [$b, []]],
    'not hex' => [fn (string $b, array $h): array => [$b, ['x-iyz-signature-v3' => 'zz']]],
    'other secret' => [fn (string $b, array $h): array => signedWebhook([], 'another-secret-value')],
    'forged status' => [fn (string $b, array $h): array => [str_replace('SUCCESS', 'FAILURE', $b), $h]],
    'not json' => [fn (string $b, array $h): array => ['{', $h]],
]);

it('rejects every event when no secret is configured', function (): void {
    [$body, $headers] = signedWebhook();
    config(['services.iyzico.secret_key' => null]);

    expect(fn () => (new IyzicoGateway)->verifyWebhook($body, $headers))->toThrow(InvalidWebhookSignature::class);
});

it('rejects a signed event outside the age window', function (string $gateway, int $ageSeconds): void {
    [$body, $headers] = signedWebhook(['iyziEventTime' => CarbonImmutable::now()->subSeconds($ageSeconds)->getTimestampMs()]);

    expect(fn () => app($gateway)->verifyWebhook($body, $headers))->toThrow(StaleWebhook::class);
})->with('gateways')->with(['too old' => 301, 'from the future' => -301]);

it('rejects a signed event without a timestamp as stale', function (): void {
    [$body, $headers] = signedWebhook(['iyziEventTime' => null]);

    expect(fn () => (new IyzicoGateway)->verifyWebhook($body, $headers))->toThrow(StaleWebhook::class);
});
