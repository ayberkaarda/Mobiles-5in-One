<?php

namespace App\Domain\Anon\Attestation;

use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\DevicePlatform;
use Firebase\JWT\JWT;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Support\Carbon;
use JsonException;
use Throwable;

/**
 * Android attestation through the Play Integrity API (server-side decode).
 *
 * The server signs an OAuth assertion (RS256) with the service account key from
 * configuration, exchanges it for an access token, then asks Google to decode the
 * integrity token. The verdict passes only when the package name matches, the request
 * nonce equals the device nonce, the token is fresh, the app is recognised by Play and
 * the device meets basic device integrity.
 */
final class PlayIntegrityVerifier implements AttestationVerifier
{
    private const ACCESS_TOKEN_CACHE_KEY = 'attestation:play-integrity:access-token';

    /**
     * @param  array<string, mixed>  $config  config('askida.attestation.play_integrity')
     */
    public function __construct(
        private readonly Http $http,
        private readonly Cache $cache,
        private readonly array $config,
        private readonly int $timeoutSeconds,
        private readonly int $maxTokenAgeSeconds,
    ) {}

    public function verify(DevicePlatform $platform, string $token, string $deviceNonce): AttestationVerdict
    {
        if ($platform !== DevicePlatform::Android) {
            throw new AttestationFailed('Play Integrity verifies Android devices only.');
        }

        $package = ProviderConfig::required($this->config['package_name'] ?? null, 'play_integrity.package_name');
        $url = ProviderConfig::httpsUrl(str_replace(
            '{package}',
            rawurlencode($package),
            ProviderConfig::required($this->config['decode_url'] ?? null, 'play_integrity.decode_url'),
        ));

        try {
            $response = $this->http->timeout($this->timeoutSeconds)
                ->acceptJson()
                ->withToken($this->accessToken())
                ->post($url, ['integrity_token' => $token]);
        } catch (ConnectionException $e) {
            throw new AttestationUnavailable('Play Integrity is unreachable.', previous: $e);
        }

        if ($response->status() === 400) {
            throw new AttestationFailed('Play Integrity rejected the token.');
        }

        $payload = $response->successful() ? $response->json('tokenPayloadExternal') : null;

        if (! is_array($payload)) {
            throw new AttestationUnavailable('Play Integrity gave no verdict.');
        }

        $this->assertPayload($payload, $package, $deviceNonce);

        return new AttestationVerdict(DevicePlatform::Android);
    }

    /**
     * @param  array<mixed>  $payload
     */
    private function assertPayload(array $payload, string $package, string $deviceNonce): void
    {
        $request = is_array($payload['requestDetails'] ?? null) ? $payload['requestDetails'] : [];

        if (($request['requestPackageName'] ?? null) !== $package) {
            throw new AttestationFailed('The integrity token belongs to another package.');
        }

        $nonce = $request['nonce'] ?? $request['requestHash'] ?? null;

        if (! is_string($nonce) || ! hash_equals($deviceNonce, $nonce)) {
            throw new AttestationFailed('The integrity token was requested for another nonce.');
        }

        $issuedMs = $request['timestampMillis'] ?? null;
        $issued = is_numeric($issuedMs) ? (int) $issuedMs : 0;
        $nowMs = Carbon::now()->getTimestampMs();

        if ($issued <= 0 || $nowMs - $issued > $this->maxTokenAgeSeconds * 1000 || $issued - $nowMs > 60_000) {
            throw new AttestationFailed('The integrity token is not fresh.');
        }

        $app = is_array($payload['appIntegrity'] ?? null) ? $payload['appIntegrity'] : [];

        if (($app['appRecognitionVerdict'] ?? null) !== 'PLAY_RECOGNIZED') {
            throw new AttestationFailed('The app is not recognised by Play.');
        }

        $device = is_array($payload['deviceIntegrity'] ?? null) ? $payload['deviceIntegrity'] : [];
        $labels = is_array($device['deviceRecognitionVerdict'] ?? null) ? $device['deviceRecognitionVerdict'] : [];

        if (! in_array('MEETS_DEVICE_INTEGRITY', $labels, true)) {
            throw new AttestationFailed('The device does not meet device integrity.');
        }
    }

    private function accessToken(): string
    {
        $cached = $this->cache->get(self::ACCESS_TOKEN_CACHE_KEY);

        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $account = $this->serviceAccount();
        $tokenUrl = ProviderConfig::httpsUrl($this->config['oauth_token_url'] ?? null);
        $now = Carbon::now()->getTimestamp();

        try {
            $assertion = JWT::encode([
                'iss' => $account['client_email'],
                'scope' => ProviderConfig::required($this->config['scope'] ?? null, 'play_integrity.scope'),
                'aud' => $tokenUrl,
                'iat' => $now,
                'exp' => $now + 3600,
            ], $account['private_key'], 'RS256');
        } catch (Throwable $e) {
            throw new AttestationUnavailable('The service account key cannot sign.', previous: $e);
        }

        try {
            $response = $this->http->timeout($this->timeoutSeconds)->asForm()->acceptJson()->post($tokenUrl, [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $assertion,
            ]);
        } catch (ConnectionException $e) {
            throw new AttestationUnavailable('The OAuth endpoint is unreachable.', previous: $e);
        }

        $accessToken = $response->successful() ? $response->json('access_token') : null;

        if (! is_string($accessToken) || $accessToken === '') {
            throw new AttestationUnavailable('No access token was issued.');
        }

        $expiresIn = $response->json('expires_in');
        $ttl = is_numeric($expiresIn) ? max(60, (int) $expiresIn - 120) : 600;
        $this->cache->put(self::ACCESS_TOKEN_CACHE_KEY, $accessToken, $ttl);

        return $accessToken;
    }

    /**
     * @return array{client_email: string, private_key: string}
     */
    private function serviceAccount(): array
    {
        $json = ProviderConfig::required($this->config['service_account_json'] ?? null, 'play_integrity.service_account_json');

        try {
            $account = json_decode($json, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new AttestationUnavailable('The service account setting is not valid JSON.', previous: $e);
        }

        if (! is_array($account)) {
            throw new AttestationUnavailable('The service account setting is not an object.');
        }

        return [
            'client_email' => ProviderConfig::required($account['client_email'] ?? null, 'service account client_email'),
            'private_key' => ProviderConfig::pem($account['private_key'] ?? null, 'service account private_key'),
        ];
    }
}
