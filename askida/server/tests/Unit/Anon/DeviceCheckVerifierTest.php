<?php

use App\Domain\Anon\Attestation\AttestationFailed;
use App\Domain\Anon\Attestation\AttestationUnavailable;
use App\Domain\Anon\Attestation\DeviceCheckVerifier;
use App\Domain\Anon\Models\DevicePlatform;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/*
| DeviceCheck adapter against fixtures built at run time with a key made locally
| (P-256). Not exercised: a real DeviceCheck call (no Apple developer account).
*/

const DC_PRODUCTION = 'https://api.devicecheck.apple.com/v1/validate_device_token';
const DC_DEVELOPMENT = 'https://api.development.devicecheck.apple.com/v1/validate_device_token';

beforeEach(function (): void {
    Http::preventStrayRequests();

    $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
    openssl_pkey_export($key, $privatePem);
    $this->publicPem = openssl_pkey_get_details($key)['key'];
    $this->teamId = strtoupper(Str::random(10));
    $this->keyId = strtoupper(Str::random(10));
    $this->config = array_merge((array) config('askida.attestation.device_check'), [
        'team_id' => $this->teamId,
        'key_id' => $this->keyId,
        // Environment values often carry escaped line breaks.
        'private_key' => str_replace("\n", '\n', $privatePem),
        'environment' => 'production',
    ]);
});

function dcVerifier(array $config): DeviceCheckVerifier
{
    return new DeviceCheckVerifier(app(Factory::class), $config, 5);
}

it('accepts a device token Apple recognises, with an ES256 request token', function (): void {
    Http::fake([DC_PRODUCTION => Http::response('', 200)]);
    $deviceToken = base64_encode(random_bytes(48));

    $verdict = dcVerifier($this->config)->verify(DevicePlatform::Ios, $deviceToken, 'nonce-not-bound-here');

    expect($verdict->verdict)->toBe('valid')->and($verdict->platform)->toBe(DevicePlatform::Ios);

    Http::assertSent(function (Request $request) use ($deviceToken): bool {
        $jwt = substr($request->header('Authorization')[0], strlen('Bearer '));
        $header = json_decode(JWT::urlsafeB64Decode(explode('.', $jwt)[0]), true);
        $claims = JWT::decode($jwt, new Key($this->publicPem, 'ES256'));

        return $request->url() === DC_PRODUCTION
            && $header['alg'] === 'ES256'
            && $header['kid'] === $this->keyId
            && $claims->iss === $this->teamId
            && abs($claims->iat - time()) < 60
            && $request['device_token'] === $deviceToken
            && Str::isUuid($request['transaction_id'])
            && is_int($request['timestamp']);
    });
});

it('uses the development endpoint when configured', function (): void {
    Http::fake([DC_DEVELOPMENT => Http::response('', 200)]);

    dcVerifier(array_merge($this->config, ['environment' => 'development']))->verify(DevicePlatform::Ios, 'token', 'nonce');

    Http::assertSent(fn (Request $request): bool => $request->url() === DC_DEVELOPMENT);
});

it('maps 400 to a rejection and other answers to unavailable', function (int $status, string $exception): void {
    Http::fake([DC_PRODUCTION => Http::response('Missing or incorrectly formatted device token payload', $status)]);

    expect(fn () => dcVerifier($this->config)->verify(DevicePlatform::Ios, 'token', 'nonce'))->toThrow($exception);
})->with([
    'bad device token' => [400, AttestationFailed::class],
    'bad request token' => [401, AttestationUnavailable::class],
    'server error' => [503, AttestationUnavailable::class],
]);

it('refuses plain HTTP and missing settings without sending anything', function (array $override): void {
    Http::fake();

    expect(fn () => dcVerifier(array_merge($this->config, $override))->verify(DevicePlatform::Ios, 'token', 'nonce'))
        ->toThrow(AttestationUnavailable::class);

    Http::assertNothingSent();
})->with([
    'http url' => [['urls' => ['production' => 'http://api.devicecheck.apple.com/v1/validate_device_token']]],
    'unknown environment' => [['environment' => 'staging']],
    'no team' => [['team_id' => '']],
    'no key id' => [['key_id' => null]],
    'no key' => [['private_key' => '']],
    'unusable key' => [['private_key' => 'not a key']],
]);

it('verifies iOS devices only', function (): void {
    Http::fake();

    expect(fn () => dcVerifier($this->config)->verify(DevicePlatform::Android, 'token', 'nonce'))->toThrow(AttestationFailed::class);
    Http::assertNothingSent();
});
