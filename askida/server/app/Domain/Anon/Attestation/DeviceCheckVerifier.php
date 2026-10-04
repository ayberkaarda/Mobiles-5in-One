<?php

namespace App\Domain\Anon\Attestation;

use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\DevicePlatform;
use Firebase\JWT\JWT;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Throwable;

/**
 * iOS attestation through Apple DeviceCheck (`validate_device_token`).
 *
 * Requests are authorised with an ES256 JWT (issuer = team id, header kid = key id)
 * signed with the DeviceCheck key from configuration. HTTP 200 means Apple recognises
 * the device token; 400 means the token is invalid. DeviceCheck proves a genuine Apple
 * device but carries no request nonce, so the device nonce is not bound here.
 */
final class DeviceCheckVerifier implements AttestationVerifier
{
    /**
     * @param  array<string, mixed>  $config  config('askida.attestation.device_check')
     */
    public function __construct(
        private readonly Http $http,
        private readonly array $config,
        private readonly int $timeoutSeconds,
    ) {}

    public function verify(DevicePlatform $platform, string $token, string $deviceNonce): AttestationVerdict
    {
        if ($platform !== DevicePlatform::Ios) {
            throw new AttestationFailed('DeviceCheck verifies iOS devices only.');
        }

        $teamId = ProviderConfig::required($this->config['team_id'] ?? null, 'device_check.team_id');
        $keyId = ProviderConfig::required($this->config['key_id'] ?? null, 'device_check.key_id');
        $key = ProviderConfig::pem($this->config['private_key'] ?? null, 'device_check.private_key');
        $urls = is_array($this->config['urls'] ?? null) ? $this->config['urls'] : [];
        $environment = is_string($this->config['environment'] ?? null) ? $this->config['environment'] : 'production';
        $url = ProviderConfig::httpsUrl($urls[$environment] ?? null);
        $now = Carbon::now();

        try {
            $jwt = JWT::encode(['iss' => $teamId, 'iat' => $now->getTimestamp()], $key, 'ES256', $keyId);
        } catch (Throwable $e) {
            throw new AttestationUnavailable('The DeviceCheck key cannot sign.', previous: $e);
        }

        try {
            $response = $this->http->timeout($this->timeoutSeconds)
                ->withToken($jwt)
                ->asJson()
                ->post($url, [
                    'device_token' => $token,
                    'transaction_id' => (string) Str::uuid7(),
                    'timestamp' => $now->getTimestampMs(),
                ]);
        } catch (ConnectionException $e) {
            throw new AttestationUnavailable('DeviceCheck is unreachable.', previous: $e);
        }

        return match (true) {
            $response->status() === 200 => new AttestationVerdict(DevicePlatform::Ios),
            $response->status() === 400 => throw new AttestationFailed('DeviceCheck rejected the device token.'),
            default => throw new AttestationUnavailable('DeviceCheck gave no verdict.'),
        };
    }
}
