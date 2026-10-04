<?php

namespace App\Domain\Payments\Gateways\Iyzico;

use App\Domain\Payments\Data\VerifiedWebhook;
use App\Domain\Payments\Exceptions\InvalidWebhookSignature;
use App\Domain\Payments\Exceptions\StaleWebhook;
use Carbon\CarbonImmutable;
use InvalidArgumentException;
use JsonException;
use SensitiveParameter;

/**
 * Verifies a webhook delivery from the raw body (see IyzicoSigner for the scheme).
 *
 * Order: the signature is checked first, on the raw body decoded once; only a correctly
 * signed body is then checked for age, so an unsigned request learns nothing else.
 *
 * Payload fields read (provider documentation; not verified, no sandbox account):
 * `iyziEventType`, `iyziEventTime` (epoch milliseconds), `iyziPaymentId`, `token`,
 * `paymentConversationId`, `status`. `iyziEventTime` is not covered by the documented
 * signature, so the age window limits replays only together with the event id
 * uniqueness of `payment_events`.
 *
 * The event id is derived from the signed fields plus the event time, so a redelivery of
 * the same event maps to the same id.
 */
final class IyzicoWebhookVerifier
{
    public function __construct(
        #[SensitiveParameter]
        private readonly string $secretKey,
        private readonly int $maxAgeSeconds,
    ) {
        if ($maxAgeSeconds < 1) {
            throw new InvalidArgumentException('The webhook age window must be positive.');
        }
    }

    /**
     * @param  array<string, array<int, string|null>|string|null>  $headers
     */
    public function verify(string $rawBody, array $headers, CarbonImmutable $now): VerifiedWebhook
    {
        $signature = self::header($headers, IyzicoSigner::WEBHOOK_SIGNATURE_HEADER);

        if ($this->secretKey === '' || $signature === null || preg_match('/^[0-9a-fA-F]{64}$/', $signature) !== 1) {
            throw new InvalidWebhookSignature;
        }

        try {
            $payload = json_decode($rawBody, true, 16, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new InvalidWebhookSignature;
        }

        if (! is_array($payload)) {
            throw new InvalidWebhookSignature;
        }

        /** @var array<string, mixed> $payload */
        $expected = IyzicoSigner::webhookSignature($this->secretKey, $payload);

        if (! hash_equals($expected, strtolower($signature))) {
            throw new InvalidWebhookSignature;
        }

        $eventType = self::text($payload, 'iyziEventType');
        $token = self::text($payload, 'token');

        if ($eventType === '' || $token === '') {
            // Correctly signed but not a checkout form event: nothing to settle.
            throw new InvalidWebhookSignature;
        }

        $eventTime = $payload['iyziEventTime'] ?? null;

        if (! is_int($eventTime) && ! (is_string($eventTime) && ctype_digit($eventTime))) {
            throw new StaleWebhook;
        }

        $occurredAt = CarbonImmutable::createFromTimestampMs((int) $eventTime, $now->getTimezone());

        if (abs($now->getTimestamp() - $occurredAt->getTimestamp()) > $this->maxAgeSeconds) {
            throw new StaleWebhook;
        }

        $paymentId = self::text($payload, 'iyziPaymentId');

        return new VerifiedWebhook(
            eventId: hash('sha256', implode('|', [$eventType, $paymentId, $token, self::text($payload, 'status'), (string) $eventTime])),
            eventType: $eventType,
            providerToken: $token,
            providerPaymentId: $paymentId === '' ? null : $paymentId,
            occurredAt: $occurredAt,
        );
    }

    /**
     * Case-insensitive header lookup over both `name => value` and `name => [values]`.
     *
     * @param  array<string, array<int, string|null>|string|null>  $headers
     */
    private static function header(array $headers, string $name): ?string
    {
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) !== $name) {
                continue;
            }

            $value = is_array($value) ? ($value[0] ?? null) : $value;

            return is_string($value) ? trim($value) : null;
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private static function text(array $payload, string $field): string
    {
        $value = $payload[$field] ?? null;

        return is_scalar($value) ? (string) $value : '';
    }
}
