<?php

use App\Domain\Anon\Attestation\AttestationFailed;
use App\Domain\Anon\Attestation\AttestationUnavailable;
use App\Domain\Anon\Attestation\AttestationVerdict;
use App\Domain\Anon\Attestation\FakeAttestationVerifier;
use App\Domain\Anon\Attestation\PlatformAttestationVerifier;
use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\Transports\LogPushTransport;
use App\Providers\AnonServiceProvider;

/*
| ATTESTATION_DRIVER / PUSH_DRIVER bindings and the production configuration guard:
| simulated adapters and an empty code pepper are refused outside local and testing.
*/

function asEnvironment(string $environment, Closure $callback): mixed
{
    $original = app()->environment();
    app()->detectEnvironment(fn (): string => $environment);

    try {
        return $callback();
    } finally {
        app()->detectEnvironment(fn (): string => $original);
    }
}

function productionReadyConfig(): void
{
    config([
        'askida.hook_code_pepper' => bin2hex(random_bytes(32)),
        'askida.attestation.driver' => 'real',
        'askida.push.driver' => 'fcm',
    ]);
}

it('binds the fake verifier in testing and the platform verifier for the real driver', function (): void {
    config(['askida.attestation.driver' => 'fake']);
    expect(app(AttestationVerifier::class))->toBeInstanceOf(FakeAttestationVerifier::class);

    config(['askida.attestation.driver' => 'real']);
    expect(app(AttestationVerifier::class))->toBeInstanceOf(PlatformAttestationVerifier::class);

    config(['askida.attestation.driver' => 'other']);
    expect(fn () => app(AttestationVerifier::class))->toThrow(RuntimeException::class);
});

it('refuses the fake verifier and the log transport outside local and testing', function (): void {
    config(['askida.attestation.driver' => 'fake', 'askida.push.driver' => 'log']);

    asEnvironment('production', function (): void {
        expect(fn () => app(AttestationVerifier::class))->toThrow(RuntimeException::class, 'ATTESTATION_DRIVER=fake')
            ->and(fn () => app(PushTransport::class))->toThrow(RuntimeException::class, 'PUSH_DRIVER=log');
    });

    asEnvironment('local', function (): void {
        expect(app(AttestationVerifier::class))->toBeInstanceOf(FakeAttestationVerifier::class)
            ->and(app(PushTransport::class))->toBeInstanceOf(LogPushTransport::class);
    });
});

it('guards the configuration of production-like environments', function (array $override, string $message): void {
    productionReadyConfig();
    AnonServiceProvider::guardConfiguration('production');

    config($override);

    expect(fn () => AnonServiceProvider::guardConfiguration('staging'))->toThrow(RuntimeException::class, $message);
})->with([
    'empty pepper' => [['askida.hook_code_pepper' => ''], 'HOOK_CODE_PEPPER'],
    'short pepper' => [['askida.hook_code_pepper' => 'short'], 'HOOK_CODE_PEPPER'],
    'fake attestation' => [['askida.attestation.driver' => 'fake'], 'ATTESTATION_DRIVER'],
    'log push' => [['askida.push.driver' => 'log'], 'PUSH_DRIVER'],
]);

it('tolerates simulated adapters and no pepper in local and testing', function (string $environment): void {
    config(['askida.hook_code_pepper' => null, 'askida.attestation.driver' => 'fake', 'askida.push.driver' => 'log']);

    AnonServiceProvider::guardConfiguration($environment);

    expect(true)->toBeTrue();
})->with(['local', 'testing']);

it('runs the guard when the provider boots', function (): void {
    config(['askida.hook_code_pepper' => '', 'askida.attestation.driver' => 'fake']);

    asEnvironment('production', function (): void {
        expect(fn () => (new AnonServiceProvider(app()))->boot())->toThrow(RuntimeException::class);
    });
});

it('lets tests script the fake verifier deterministically', function (): void {
    $fake = new FakeAttestationVerifier;

    expect($fake->verify(DevicePlatform::Ios, 'anything', 'nonce-1')->verdict)->toBe('valid')
        ->and(fn () => $fake->verify(DevicePlatform::Ios, 'reject-me', 'nonce-2'))->toThrow(AttestationFailed::class)
        ->and(fn () => $fake->verify(DevicePlatform::Ios, 'unavailable', 'nonce-3'))->toThrow(AttestationUnavailable::class);

    $fake->queue(new AttestationVerdict(DevicePlatform::Android, 'scripted'));
    expect($fake->verify(DevicePlatform::Android, 'reject-me', 'nonce-4')->verdict)->toBe('scripted');

    $fake->using(fn (DevicePlatform $platform): AttestationVerdict => new AttestationVerdict($platform, 'handler'));
    expect($fake->verify(DevicePlatform::Android, 'reject-me', 'nonce-5')->verdict)->toBe('handler')
        ->and(array_column($fake->calls(), 'nonce'))->toBe(['nonce-1', 'nonce-2', 'nonce-3', 'nonce-4', 'nonce-5']);
});
