<?php

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Providers\PaymentsServiceProvider;

/**
 * A minimal gateway standing in for the real implementations, which live in the payments area.
 */
function stubGateway(): PaymentGateway
{
    return Mockery::mock(PaymentGateway::class);
}

it('resolves the fake gateway by provider name', function (): void {
    $stub = stubGateway();
    config(['payments.provider' => 'fake']);
    app()->bind('App\\Domain\\Payments\\Gateways\\FakeGateway', fn () => $stub);

    expect(app(PaymentGateway::class))->toBe($stub);
});

it('resolves the iyzico gateway by provider name', function (): void {
    $stub = stubGateway();
    config(['payments.provider' => 'iyzico']);
    app()->bind('App\\Domain\\Payments\\Gateways\\IyzicoGateway', fn () => $stub);

    expect(app(PaymentGateway::class))->toBe($stub);
});

it('rejects an unknown provider name', function (): void {
    config(['payments.provider' => 'unknown']);

    expect(fn () => app(PaymentGateway::class))->toThrow(InvalidArgumentException::class);
});

it('rejects an implementation that does not honour the contract', function (): void {
    config(['payments.provider' => 'fake']);
    app()->bind('App\\Domain\\Payments\\Gateways\\FakeGateway', fn () => new stdClass);

    expect(fn () => app(PaymentGateway::class))->toThrow(RuntimeException::class);
});

it('refuses the fake gateway in production-like environments', function (string $environment): void {
    config(['payments.provider' => 'fake']);
    app()['env'] = $environment;

    expect(fn () => (new PaymentsServiceProvider(app()))->boot())
        ->toThrow(RuntimeException::class, 'fake payment gateway');
})->with(['production', 'staging']);

it('allows the fake gateway locally and in tests', function (string $environment): void {
    config(['payments.provider' => 'fake']);
    app()['env'] = $environment;

    (new PaymentsServiceProvider(app()))->boot();

    expect(true)->toBeTrue();
})->with(['local', 'testing']);

it('allows iyzico in production', function (): void {
    config(['payments.provider' => 'iyzico']);
    app()['env'] = 'production';

    (new PaymentsServiceProvider(app()))->boot();

    expect(true)->toBeTrue();
});

it('reads the payments configuration defaults', function (): void {
    expect(config('payments.caps.transaction_minor'))->toBe(200_000)
        ->and(config('payments.caps.donor_day_minor'))->toBe(500_000)
        ->and(config('payments.webhook_max_age_seconds'))->toBe(300)
        ->and(config('payments.finance_alert_email'))->toBeString()
        ->and(config('payments.fraud.max_redeems_per_hour'))->toBe(30)
        ->and(config('payments.fraud.max_self_redeem_ratio'))->toBe(0.5)
        ->and(config('services.iyzico'))->toHaveKeys(['base_url', 'api_key', 'secret_key']);
});
