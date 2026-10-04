<?php

namespace App\Domain\Auth\Identity;

use App\Domain\Auth\Contracts\IdentityTokenVerifier;
use App\Domain\Auth\Enums\IdentityProvider;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Firebase\JWT\BeforeValidException;
use Firebase\JWT\ExpiredException;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Firebase\JWT\SignatureInvalidException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use stdClass;
use Throwable;

/**
 * Verifies Apple and Google ID tokens against the provider's published JSON Web Key Set.
 *
 * Accepted tokens are RS256 only, signed by a key of the provider's JWKS (fetched over
 * HTTPS with a timeout and cached), with an allowed issuer, an audience equal to one of
 * the configured client ids, a valid expiry and the nonce of this sign-in.
 */
final class JwksIdentityTokenVerifier implements IdentityTokenVerifier
{
    private const ALGORITHM = 'RS256';

    public function verify(IdentityProvider $provider, string $idToken, string $nonce): VerifiedIdentity
    {
        $settings = $this->settings($provider);
        $kid = $this->keyIdFromHeader($idToken);

        $keys = $this->keys($provider, $settings['jwks_url'], false);

        if (! isset($keys[$kid])) {
            // The provider may have rotated its keys since the set was cached.
            $keys = $this->keys($provider, $settings['jwks_url'], true);
        }

        if (! isset($keys[$kid])) {
            throw InvalidIdentityToken::because('unknown_key');
        }

        $claims = $this->decode($idToken, $keys);

        $this->assertIssuer($claims, $settings['issuers']);
        $this->assertAudience($claims, $settings['client_id']);
        $this->assertNonce($claims, $nonce, $settings['nonce_hashed']);

        if (! isset($claims->exp) || ! is_numeric($claims->exp)) {
            throw InvalidIdentityToken::because('missing_expiry');
        }

        if (! isset($claims->sub) || ! is_string($claims->sub) || $claims->sub === '') {
            throw InvalidIdentityToken::because('missing_subject');
        }

        $email = isset($claims->email) && is_string($claims->email) && $claims->email !== ''
            ? Str::lower($claims->email)
            : null;
        $emailVerified = isset($claims->email_verified)
            && ($claims->email_verified === true || $claims->email_verified === 'true');
        $name = isset($claims->name) && is_string($claims->name) && $claims->name !== '' ? $claims->name : null;

        return new VerifiedIdentity($claims->sub, $email, $email !== null && $emailVerified, $name);
    }

    /**
     * @return array{client_id: list<string>, issuers: list<string>, jwks_url: string, nonce_hashed: bool}
     */
    private function settings(IdentityProvider $provider): array
    {
        /** @var array{client_id?: list<string>, issuers?: list<string>, jwks_url?: string, nonce_hashed?: bool} $config */
        $config = (array) config('services.'.$provider->value, []);

        $url = (string) ($config['jwks_url'] ?? '');

        if (! str_starts_with($url, 'https://')) {
            throw new RuntimeException('The identity provider key set URL must use HTTPS.');
        }

        return [
            'client_id' => $config['client_id'] ?? [],
            'issuers' => $config['issuers'] ?? [],
            'jwks_url' => $url,
            'nonce_hashed' => (bool) ($config['nonce_hashed'] ?? false),
        ];
    }

    private function keyIdFromHeader(string $idToken): string
    {
        $segments = explode('.', $idToken);

        if (count($segments) !== 3) {
            throw InvalidIdentityToken::because('malformed');
        }

        try {
            $header = JWT::jsonDecode(JWT::urlsafeB64Decode($segments[0]));
        } catch (Throwable) {
            throw InvalidIdentityToken::because('malformed');
        }

        if (! $header instanceof stdClass) {
            throw InvalidIdentityToken::because('malformed');
        }

        // Only RS256 is accepted: this rejects "none" and HMAC key-confusion tokens
        // before any key material is touched.
        if (! isset($header->alg) || $header->alg !== self::ALGORITHM) {
            throw InvalidIdentityToken::because('unsupported_algorithm');
        }

        if (! isset($header->kid) || ! is_string($header->kid) || $header->kid === '') {
            throw InvalidIdentityToken::because('missing_key_id');
        }

        return $header->kid;
    }

    /**
     * @return array<string, Key>
     */
    private function keys(IdentityProvider $provider, string $url, bool $refresh): array
    {
        $cacheKey = 'auth:jwks:'.$provider->value;

        if ($refresh) {
            Cache::forget($cacheKey);
        }

        /** @var list<array<string, string>> $jwks */
        $jwks = Cache::remember(
            $cacheKey,
            (int) config('services.identity_tokens.jwks_cache_seconds', 3600),
            fn (): array => $this->fetchKeySet($provider, $url),
        );

        return JWK::parseKeySet(['keys' => $jwks], self::ALGORITHM);
    }

    /**
     * @return list<array<string, string>>
     */
    private function fetchKeySet(IdentityProvider $provider, string $url): array
    {
        $timeout = (int) config('services.identity_tokens.http_timeout_seconds', 5);

        try {
            $response = Http::timeout($timeout)->connectTimeout($timeout)->acceptJson()->get($url);
            $body = $response->successful() ? $response->json() : null;
        } catch (Throwable) {
            $body = null;
        }

        if (! is_array($body) || ! isset($body['keys']) || ! is_array($body['keys'])) {
            Log::warning('Identity provider key set unavailable.', ['provider' => $provider->value]);

            throw ProblemException::make(ProblemCode::ServerError, 503, 'Identity provider key set unavailable.');
        }

        $usable = [];

        foreach ($body['keys'] as $jwk) {
            if (! is_array($jwk)
                || ($jwk['kty'] ?? null) !== 'RSA'
                || ! isset($jwk['kid'], $jwk['n'], $jwk['e'])
                || ! is_string($jwk['kid'])
                || (isset($jwk['alg']) && $jwk['alg'] !== self::ALGORITHM)
                || (isset($jwk['use']) && $jwk['use'] !== 'sig')) {
                continue;
            }

            $usable[] = [
                'kty' => 'RSA',
                'kid' => $jwk['kid'],
                'n' => (string) $jwk['n'],
                'e' => (string) $jwk['e'],
                'alg' => self::ALGORITHM,
            ];
        }

        if ($usable === []) {
            Log::warning('Identity provider key set has no usable keys.', ['provider' => $provider->value]);

            throw ProblemException::make(ProblemCode::ServerError, 503, 'Identity provider key set unavailable.');
        }

        return $usable;
    }

    /**
     * @param  array<string, Key>  $keys
     */
    private function decode(string $idToken, array $keys): stdClass
    {
        $previousTimestamp = JWT::$timestamp;
        $previousLeeway = JWT::$leeway;

        JWT::$timestamp = Carbon::now()->getTimestamp();
        JWT::$leeway = (int) config('services.identity_tokens.leeway_seconds', 60);

        try {
            return JWT::decode($idToken, $keys);
        } catch (ExpiredException) {
            throw InvalidIdentityToken::because('expired');
        } catch (BeforeValidException) {
            throw InvalidIdentityToken::because('not_yet_valid');
        } catch (SignatureInvalidException) {
            throw InvalidIdentityToken::because('bad_signature');
        } catch (Throwable) {
            throw InvalidIdentityToken::because('malformed');
        } finally {
            JWT::$timestamp = $previousTimestamp;
            JWT::$leeway = $previousLeeway;
        }
    }

    /**
     * @param  list<string>  $issuers
     */
    private function assertIssuer(stdClass $claims, array $issuers): void
    {
        if (! isset($claims->iss) || ! is_string($claims->iss) || ! in_array($claims->iss, $issuers, true)) {
            throw InvalidIdentityToken::because('wrong_issuer');
        }
    }

    /**
     * @param  list<string>  $clientIds
     */
    private function assertAudience(stdClass $claims, array $clientIds): void
    {
        $audiences = isset($claims->aud) ? (is_array($claims->aud) ? $claims->aud : [$claims->aud]) : [];
        $audiences = array_values(array_filter($audiences, 'is_string'));

        if ($clientIds === [] || array_intersect($audiences, $clientIds) === []) {
            throw InvalidIdentityToken::because('wrong_audience');
        }
    }

    private function assertNonce(stdClass $claims, string $nonce, bool $hashed): void
    {
        $expected = $hashed ? hash('sha256', $nonce) : $nonce;

        if ($nonce === '' || ! isset($claims->nonce) || ! is_string($claims->nonce)
            || ! hash_equals($expected, $claims->nonce)) {
            throw InvalidIdentityToken::because('nonce_mismatch');
        }
    }
}
