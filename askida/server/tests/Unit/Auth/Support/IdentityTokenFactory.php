<?php

namespace Tests\Unit\Auth\Support;

use App\Domain\Auth\Enums\IdentityProvider;
use Firebase\JWT\JWT;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Builds identity tokens for tests. The RSA key pair is created at run time and
 * never written anywhere; token strings exist only in memory during the test.
 */
final class IdentityTokenFactory
{
    public const CLIENT_ID_APPLE = 'app.askida.test';

    public const CLIENT_ID_GOOGLE = 'askida-test-client.apps.example';

    public readonly string $kid;

    private readonly string $privateKeyPem;

    private readonly string $publicKeyPem;

    /** @var array{n: string, e: string} */
    private readonly array $publicParts;

    public function __construct()
    {
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);

        if ($key === false || ! openssl_pkey_export($key, $privatePem)) {
            throw new RuntimeException('Could not create a test RSA key.');
        }

        $details = openssl_pkey_get_details($key);

        if ($details === false) {
            throw new RuntimeException('Could not read the test RSA key.');
        }

        $this->kid = 'test-'.bin2hex(random_bytes(4));
        $this->privateKeyPem = $privatePem;
        $this->publicKeyPem = $details['key'];
        $this->publicParts = [
            'n' => JWT::urlsafeB64Encode($details['rsa']['n']),
            'e' => JWT::urlsafeB64Encode($details['rsa']['e']),
        ];
    }

    /**
     * Configures client ids and fakes the provider key set endpoints.
     */
    public function install(): void
    {
        config([
            'services.apple.client_id' => [self::CLIENT_ID_APPLE],
            'services.google.client_id' => [self::CLIENT_ID_GOOGLE],
        ]);

        Http::fake([
            'appleid.apple.com/*' => Http::response($this->jwks()),
            'www.googleapis.com/*' => Http::response($this->jwks()),
        ]);
    }

    /**
     * @return array{keys: list<array<string, string>>}
     */
    public function jwks(): array
    {
        return ['keys' => [[
            'kty' => 'RSA',
            'kid' => $this->kid,
            'use' => 'sig',
            'alg' => 'RS256',
            'n' => $this->publicParts['n'],
            'e' => $this->publicParts['e'],
        ]]];
    }

    /**
     * @param  array<string, mixed>  $overrides  claims to replace; a null value removes the claim
     * @return array<string, mixed>
     */
    public static function claims(IdentityProvider $provider, string $nonce, array $overrides = []): array
    {
        $now = Carbon::now()->getTimestamp();

        $claims = [
            'iss' => $provider === IdentityProvider::Apple ? 'https://appleid.apple.com' : 'https://accounts.google.com',
            'aud' => $provider === IdentityProvider::Apple ? self::CLIENT_ID_APPLE : self::CLIENT_ID_GOOGLE,
            'sub' => $provider->value.'-sub-'.bin2hex(random_bytes(4)),
            'email' => 'person-'.bin2hex(random_bytes(3)).'@example.test',
            'email_verified' => true,
            'iat' => $now,
            'exp' => $now + 600,
            'nonce' => $provider === IdentityProvider::Apple ? hash('sha256', $nonce) : $nonce,
        ];

        foreach ($overrides as $name => $value) {
            if ($value === null) {
                unset($claims[$name]);
            } else {
                $claims[$name] = $value;
            }
        }

        return $claims;
    }

    /**
     * @param  array<string, mixed>  $claims
     */
    public function sign(array $claims, ?string $kid = null): string
    {
        return JWT::encode($claims, $this->privateKeyPem, 'RS256', $kid ?? $this->kid);
    }

    /**
     * Unsigned token with `alg: none`.
     *
     * @param  array<string, mixed>  $claims
     */
    public function unsigned(array $claims): string
    {
        $header = JWT::urlsafeB64Encode(json_encode(['alg' => 'none', 'typ' => 'JWT', 'kid' => $this->kid], JSON_THROW_ON_ERROR));
        $body = JWT::urlsafeB64Encode(json_encode($claims, JSON_THROW_ON_ERROR));

        return $header.'.'.$body.'.';
    }

    /**
     * HMAC token keyed with the public key, the classic algorithm confusion attack.
     *
     * @param  array<string, mixed>  $claims
     */
    public function hmacWithPublicKey(array $claims): string
    {
        return JWT::encode($claims, $this->publicKeyPem, 'HS256', $this->kid);
    }

    public static function nonce(): string
    {
        return bin2hex(random_bytes(16));
    }
}
