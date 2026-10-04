<?php

namespace App\Domain\Payments\Gateways\Iyzico;

use InvalidArgumentException;
use SensitiveParameter;

/**
 * Request authentication and webhook signatures of the provider, kept in one place.
 *
 * Request scheme (`IYZWSv2`, per the provider's published API documentation):
 *   signature     = hex(HMAC-SHA256(key = secret key, message = random key + uri path + request body))
 *   Authorization = "IYZWSv2 " + base64("apiKey:" + api key + "&randomKey:" + random key + "&signature:" + signature)
 *   x-iyzi-rnd    = random key
 * The uri path is the request path without the base url and without a query string.
 *
 * Webhook scheme (header `X-IYZ-SIGNATURE-V3`):
 *   checkout form events: message = secret key + iyziEventType + iyziPaymentId + token + paymentConversationId + status
 *   direct api events:    message = secret key + iyziEventType + paymentId + paymentConversationId + status
 *   signature = hex(HMAC-SHA256(key = secret key, message))
 *
 * Provider facts not verified (no sandbox account, never exercised against the provider):
 * the exact concatenation order of both messages, lower-case hex output, the uri path
 * excluding the query string, and the header names. They follow the public documentation
 * as read; a change at the provider only needs this class to change.
 *
 * The keys never leave this object: it has no getters and hides them from dumps.
 */
final class IyzicoSigner
{
    public const AUTH_SCHEME = 'IYZWSv2';

    public const RANDOM_HEADER = 'x-iyzi-rnd';

    public const WEBHOOK_SIGNATURE_HEADER = 'x-iyz-signature-v3';

    public function __construct(
        #[SensitiveParameter]
        private readonly string $apiKey,
        #[SensitiveParameter]
        private readonly string $secretKey,
    ) {
        if ($apiKey === '' || $secretKey === '') {
            throw new InvalidArgumentException('The provider credentials are not configured.');
        }
    }

    /**
     * Authentication headers of one API request.
     *
     * @return array<string, string>
     */
    public function requestHeaders(string $uriPath, string $body, string $randomKey): array
    {
        $signature = hash_hmac('sha256', $randomKey.$uriPath.$body, $this->secretKey);
        $credentials = 'apiKey:'.$this->apiKey.'&randomKey:'.$randomKey.'&signature:'.$signature;

        return [
            'Authorization' => self::AUTH_SCHEME.' '.base64_encode($credentials),
            self::RANDOM_HEADER => $randomKey,
        ];
    }

    /**
     * Expected `X-IYZ-SIGNATURE-V3` value for a webhook payload. Static because webhook
     * verification needs only the secret key, not the api key.
     *
     * @param  array<string, mixed>  $payload  the decoded webhook body
     */
    public static function webhookSignature(#[SensitiveParameter] string $secretKey, array $payload): string
    {
        if ($secretKey === '') {
            throw new InvalidArgumentException('The provider secret key is not configured.');
        }

        return hash_hmac('sha256', $secretKey.self::webhookMessage($payload), $secretKey);
    }

    /**
     * The signed fields of a webhook payload in their documented order (without the
     * leading secret key). Checkout form events carry a `token`; direct API events do not.
     *
     * @param  array<string, mixed>  $payload
     */
    public static function webhookMessage(array $payload): string
    {
        $field = static fn (string $name): string => is_scalar($payload[$name] ?? null) ? (string) $payload[$name] : '';

        if ($field('token') !== '') {
            return $field('iyziEventType').$field('iyziPaymentId').$field('token').$field('paymentConversationId').$field('status');
        }

        return $field('iyziEventType').$field('paymentId').$field('paymentConversationId').$field('status');
    }

    /**
     * @return array<string, string>
     */
    public function __debugInfo(): array
    {
        return ['apiKey' => '***', 'secretKey' => '***'];
    }
}
