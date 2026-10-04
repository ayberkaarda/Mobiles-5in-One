<?php

use App\Domain\Anon\Attestation\AttestationFailed;
use App\Domain\Anon\Attestation\AttestationUnavailable;
use App\Domain\Anon\Attestation\PlayIntegrityVerifier;
use App\Domain\Anon\Models\DevicePlatform;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/*
| Play Integrity adapter against recorded-shape fixtures built at run time with a
| service account key made locally. Not exercised: a real Play Integrity call
| (no Google Cloud project or Play Console link).
*/

const PI_DECODE = 'https://playintegrity.googleapis.com/v1/*';
const PI_OAUTH = 'https://oauth2.googleapis.com/token';

beforeEach(function (): void {
    Http::preventStrayRequests();
    Cache::flush();

    $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
    openssl_pkey_export($key, $privatePem);
    $this->publicPem = openssl_pkey_get_details($key)['key'];
    $this->accessToken = Str::random(40);
    $this->package = 'app.askida.test';
    $this->nonce = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    $this->config = array_merge((array) config('askida.attestation.play_integrity'), [
        'package_name' => $this->package,
        'service_account_json' => json_encode(['client_email' => 'verifier@askida-test.iam.example', 'private_key' => $privatePem]),
    ]);
});

function piVerifier(array $config): PlayIntegrityVerifier
{
    return new PlayIntegrityVerifier(app(Factory::class), Cache::store(), $config, 5, 600);
}

function piPayload(object $test, array $override = []): array
{
    return array_replace_recursive([
        'requestDetails' => [
            'requestPackageName' => $test->package,
            'nonce' => $test->nonce,
            'timestampMillis' => (string) now()->getTimestampMs(),
        ],
        'appIntegrity' => ['appRecognitionVerdict' => 'PLAY_RECOGNIZED'],
        'deviceIntegrity' => ['deviceRecognitionVerdict' => ['MEETS_DEVICE_INTEGRITY']],
    ], $override);
}

function piFake(object $test, mixed $decode): void
{
    Http::fake([
        PI_OAUTH => Http::response(['access_token' => $test->accessToken, 'expires_in' => 3599]),
        PI_DECODE => $decode,
    ]);
}

it('accepts a fresh verdict for the package and nonce and signs the OAuth assertion', function (): void {
    piFake($this, Http::response(['tokenPayloadExternal' => piPayload($this)]));
    $integrityToken = Str::random(64);

    $verdict = piVerifier($this->config)->verify(DevicePlatform::Android, $integrityToken, $this->nonce);

    expect($verdict->verdict)->toBe('valid')->and($verdict->platform)->toBe(DevicePlatform::Android);

    Http::assertSent(function (Request $request): bool {
        if ($request->url() !== PI_OAUTH) {
            return false;
        }

        $claims = JWT::decode((string) $request['assertion'], new Key($this->publicPem, 'RS256'));

        return $request['grant_type'] === 'urn:ietf:params:oauth:grant-type:jwt-bearer'
            && $claims->iss === 'verifier@askida-test.iam.example'
            && $claims->aud === PI_OAUTH
            && $claims->scope === 'https://www.googleapis.com/auth/playintegrity';
    });

    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://playintegrity.googleapis.com/v1/app.askida.test:decodeIntegrityToken'
        && $request->hasHeader('Authorization', 'Bearer '.$this->accessToken)
        && $request['integrity_token'] === $integrityToken);
});

it('reuses the cached access token', function (): void {
    piFake($this, Http::response(['tokenPayloadExternal' => piPayload($this)]));
    $verifier = piVerifier($this->config);

    $verifier->verify(DevicePlatform::Android, 'first', $this->nonce);
    $verifier->verify(DevicePlatform::Android, 'second', $this->nonce);

    Http::assertSentCount(3);
});

it('rejects verdicts that do not meet the bar', function (array $override): void {
    piFake($this, Http::response(['tokenPayloadExternal' => piPayload($this, $override)]));

    expect(fn () => piVerifier($this->config)->verify(DevicePlatform::Android, 'token', $this->nonce))
        ->toThrow(AttestationFailed::class);
})->with([
    'other package' => [['requestDetails' => ['requestPackageName' => 'com.other.app']]],
    'other nonce' => [['requestDetails' => ['nonce' => 'another-nonce-value-000']]],
    'stale token' => [['requestDetails' => ['timestampMillis' => '1000']]],
    'unrecognised app' => [['appIntegrity' => ['appRecognitionVerdict' => 'UNRECOGNIZED_VERSION']]],
    'basic integrity only' => [['deviceIntegrity' => ['deviceRecognitionVerdict' => ['MEETS_BASIC_INTEGRITY']]]],
]);

it('treats a provider 400 as a rejection and other failures as unavailable', function (mixed $decode, string $exception): void {
    piFake($this, $decode);

    expect(fn () => piVerifier($this->config)->verify(DevicePlatform::Android, 'token', $this->nonce))->toThrow($exception);
})->with([
    'bad token' => [fn () => Http::response(['error' => 'bad token'], 400), AttestationFailed::class],
    'server error' => [fn () => Http::response([], 500), AttestationUnavailable::class],
    'no payload' => [fn () => Http::response(['unexpected' => true]), AttestationUnavailable::class],
]);

it('fails closed when no access token is issued', function (): void {
    Http::fake([PI_OAUTH => Http::response(['error' => 'invalid_grant'], 400), PI_DECODE => Http::response([])]);

    expect(fn () => piVerifier($this->config)->verify(DevicePlatform::Android, 'token', $this->nonce))->toThrow(AttestationUnavailable::class);
    Http::assertSentCount(1);
});

it('fails closed when the provider is unreachable', function (): void {
    Http::fake([PI_OAUTH => Http::response(['access_token' => $this->accessToken]), PI_DECODE => fn () => throw new ConnectionException('timeout')]);

    expect(fn () => piVerifier($this->config)->verify(DevicePlatform::Android, 'token', $this->nonce))->toThrow(AttestationUnavailable::class);
});

it('refuses plain HTTP endpoints and missing settings without sending anything', function (array $override): void {
    Http::fake();

    expect(fn () => piVerifier(array_merge($this->config, $override))->verify(DevicePlatform::Android, 'token', $this->nonce))
        ->toThrow(AttestationUnavailable::class);

    Http::assertNothingSent();
})->with([
    'http decode url' => [['decode_url' => 'http://playintegrity.googleapis.com/v1/{package}:decodeIntegrityToken']],
    'http oauth url' => [['oauth_token_url' => 'http://oauth2.googleapis.com/token']],
    'no package' => [['package_name' => null]],
    'no service account' => [['service_account_json' => '']],
    'broken service account' => [['service_account_json' => '{not json']],
]);

it('verifies Android devices only', function (): void {
    Http::fake();

    expect(fn () => piVerifier($this->config)->verify(DevicePlatform::Ios, 'token', $this->nonce))->toThrow(AttestationFailed::class);
    Http::assertNothingSent();
});
