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
 * The event id is the hash of the exact message the signature authenticated (the
 * concatenation of the signed fields), so a redelivery of the same event maps to the
 * same id, and so does a body whose field boundaries were moved without changing the
 * signed bytes (for example a character shifted from the payment id to the event type).
 * The fields must also have their documented shape (provider format, not verified):
 * event type upper-case letters, digits and underscores; payment id digits; token and
 * conversation id letters, digits, `-` and `_`; status upper-case letters and underscores.
 */
final class IyzicoWebhookVerifier
{
    /**
     * Field name => pattern a signed field must match (an empty optional field passes).
     *
     * @var array<string, array{0: string, 1: bool}> pattern, required
     */
    public const FIELD_FORMATS = [
        'iyziEventType' => ['/^[A-Z][A-Z0-9_]{0,63}$/', true],
        'iyziPaymentId' => ['/^[0-9]{1,20}$/', false],
        'token' => ['/^[A-Za-z0-9_-]{1,128}$/', true],
        'paymentConversationId' => ['/^[A-Za-z0-9_-]{1,64}$/', false],
        'status' => ['/^[A-Z_]{1,32}$/', false],
    ];

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

        foreach (self::FIELD_FORMATS as $field => [$pattern, $required]) {
            $value = self::text($payload, $field);

            // Correctly signed but not a well-formed checkout form event: nothing to settle.
            if (($value === '' && $required) || ($value !== '' && preg_match($pattern, $value) !== 1)) {
                throw new InvalidWebhookSignature;
            }
        }

        $eventType = self::text($payload, 'iyziEventType');
        $token = self::text($payload, 'token');

        $eventTime = $payload['iyziEventTime'] ?? null;

        if (! is_int($eventTime) && ! (is_string($eventTime) && ctype_digit($eventTime))) {
            throw new StaleWebhook;
        }

        $occurredAt = CarbonImmutable::createFromTimestampMs((int) $eventTime, $now->getTimezone());

        if (abs($now->getTimestamp() - $occurredAt->getTimestamp()) > $this->maxAgeSeconds) {
            throw new StaleWebhook;
        }

        $paymentId = self::text($payload, 'iyziPaymentId');

        // Provider fact, not verified against a sandbox: the V3 signature covers the event
        // type, payment id, token, conversation id and status, but NOT `iyziEventTime`. The
        // age check therefore reads an unsigned value, so a holder of a valid payload can
        // move the timestamp to pass it; the replay is harmless because the dedup id below
        // is the hash of the authenticated message only and settlement re-reads the payment.
        return new VerifiedWebhook(
            eventId: hash('sha256', 'v3|'.IyzicoSigner::webhookMessage($payload)),
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
