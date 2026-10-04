<?php

use App\Domain\Anon\Attestation\AttestationFailed;
use App\Domain\Anon\Attestation\AttestationUnavailable;
use App\Domain\Anon\Attestation\FakeAttestationVerifier;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Anon\Models\DevicePlatform;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;

/*
| POST /api/v1/anon/attest: attestation verdict -> anon_id -> one anon token per
| device (story 5, security items 5 and 12).
*/

uses(RefreshDatabase::class);

function attestCall(array $body, array $server = []): TestResponse
{
    app('auth')->forgetGuards();

    return test()->withServerVariables($server)->postJson('/api/v1/anon/attest', $body);
}

function deviceNonce(): string
{
    return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
}

function attestBody(?string $nonce = null, string $platform = 'android', string $token = 'attestation-ok'): array
{
    return ['platform' => $platform, 'token' => $token, 'device_nonce' => $nonce ?? deviceNonce()];
}

it('binds a new anon id and issues one anon token', function (): void {
    $response = attestCall(attestBody());

    $response->assertOk();
    expect(array_keys($response->json()))->toBe(['token', 'token_type', 'expires_at', 'abilities'])
        ->and($response->json('token_type'))->toBe('Bearer')
        ->and($response->json('abilities'))->toBe(['anon'])
        ->and(CarbonImmutable::parse($response->json('expires_at'))->diffInDays(CarbonImmutable::now(), true))->toBeGreaterThan(29.9);

    $device = AnonDevice::query()->sole();
    expect(Str::isUuid($device->anon_id))->toBeTrue()
        ->and(substr($device->anon_id, 14, 1))->toBe('7')
        ->and($device->platform)->toBe(DevicePlatform::Android)
        ->and($device->attestation_verdict)->toBe('valid')
        ->and($device->attested_at)->not->toBeNull()
        ->and($response->getContent())->not->toContain($device->anon_id);

    $token = PersonalAccessToken::findToken((string) $response->json('token'));
    expect($token?->tokenable_id)->toBe($device->id)
        ->and($token?->abilities)->toBe(['anon'])
        ->and($token?->platform)->toBe('android');
});

it('keeps the same anon id for the same install and leaves one active token', function (): void {
    $nonce = deviceNonce();

    $first = attestCall(attestBody($nonce));
    $second = attestCall(attestBody($nonce));

    expect(AnonDevice::query()->count())->toBe(1)
        ->and(DB::table('personal_access_tokens')->where('tokenable_type', AnonDevice::class)->count())->toBe(1)
        ->and(PersonalAccessToken::findToken((string) $first->json('token')))->toBeNull()
        ->and(PersonalAccessToken::findToken((string) $second->json('token')))->not->toBeNull();

    attestCall(attestBody());
    expect(AnonDevice::query()->count())->toBe(2);
});

it('refuses a banned device before asking the provider', function (): void {
    $nonce = deviceNonce();
    attestCall(attestBody($nonce))->assertOk();
    AnonDevice::query()->update(['banned_at' => now()]);
    $calls = count(app(FakeAttestationVerifier::class)->calls());

    $response = attestCall(attestBody($nonce));

    $response->assertForbidden();
    expect($response->json('code'))->toBe('forbidden')
        ->and(app(FakeAttestationVerifier::class)->calls())->toHaveCount($calls)
        ->and(DB::table('personal_access_tokens')->count())->toBe(1);
});

it('answers a rejected attestation with 401 and an unreachable provider with 503', function (): void {
    app(FakeAttestationVerifier::class)->queue(new AttestationFailed('scripted'), new AttestationUnavailable('scripted'));

    $rejected = attestCall(attestBody());
    $rejected->assertStatus(401);
    expect($rejected->json('code'))->toBe('auth.token_invalid');

    $down = attestCall(attestBody());
    $down->assertStatus(503);
    expect($down->json('code'))->toBe('service_unavailable')
        ->and(AnonDevice::query()->count())->toBe(0)
        ->and(DB::table('personal_access_tokens')->count())->toBe(0);
});

it('validates platform, token and device nonce', function (array $body, string $field, string $rule): void {
    $response = attestCall($body);

    $response->assertStatus(422);
    expect($response->json('errors'))->toContain(['field' => $field, 'code' => $rule]);
})->with([
    'web platform' => [['platform' => 'web', 'token' => 'x', 'device_nonce' => str_repeat('a', 20)], 'platform', 'enum'],
    'missing token' => [['platform' => 'ios', 'device_nonce' => str_repeat('a', 20)], 'token', 'required'],
    'short nonce' => [['platform' => 'ios', 'token' => 'x', 'device_nonce' => 'abc'], 'device_nonce', 'regex'],
    'nonce with symbols' => [['platform' => 'ios', 'token' => 'x', 'device_nonce' => str_repeat('a', 20).'/+'], 'device_nonce', 'regex'],
]);

it('limits attestation to 3 a day per device key', function (): void {
    $nonce = deviceNonce();

    foreach (range(1, 3) as $n) {
        attestCall(attestBody($nonce))->assertOk();
    }

    $limited = attestCall(attestBody($nonce));
    $limited->assertStatus(429);
    expect($limited->json('code'))->toBe('rate_limited')
        ->and((int) $limited->headers->get('Retry-After'))->toBeGreaterThan(3600);

    // The device key is the nonce plus the client IP.
    attestCall(attestBody($nonce), ['REMOTE_ADDR' => '198.51.100.7'])->assertOk();
    attestCall(attestBody())->assertOk();
});

it('ignores a spoofed forwarded address for the attest limiter', function (): void {
    $nonce = deviceNonce();

    foreach (range(1, 3) as $n) {
        attestCall(attestBody($nonce), ['HTTP_X_FORWARDED_FOR' => '203.0.113.'.$n])->assertOk();
    }

    attestCall(attestBody($nonce), ['HTTP_X_FORWARDED_FOR' => '203.0.113.99'])->assertStatus(429);
});
