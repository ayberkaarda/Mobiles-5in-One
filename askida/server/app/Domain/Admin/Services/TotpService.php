<?php

namespace App\Domain\Admin\Services;

use InvalidArgumentException;
use SensitiveParameter;

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP, HMAC-SHA1), the scheme
 * every common authenticator app implements.
 *
 * - 160-bit secrets from random_bytes, base32 encoded;
 * - 30-second steps, 6 digits, one step of tolerance on each side;
 * - codes compared in constant time;
 * - a step at or below the last accepted step is refused, so a code cannot be replayed
 *   inside its window (the caller stores the returned step).
 */
final class TotpService
{
    public const SECRET_BYTES = 20;

    public function __construct(
        private readonly int $period = 30,
        private readonly int $digits = 6,
        private readonly int $window = 1,
    ) {
        if ($period < 1 || $digits < 6 || $digits > 8 || $window < 0) {
            throw new InvalidArgumentException('Invalid TOTP parameters.');
        }
    }

    public function generateSecret(): string
    {
        return Base32::encode(random_bytes(self::SECRET_BYTES));
    }

    public function stepAt(int $timestamp): int
    {
        return intdiv($timestamp, $this->period);
    }

    /**
     * The code of the step that contains the timestamp.
     */
    public function codeAt(#[SensitiveParameter] string $secret, int $timestamp): string
    {
        return self::hotp(Base32::decode($secret), $this->stepAt($timestamp), $this->digits);
    }

    /**
     * Checks a code against the steps around now. Returns the matched step, or null when
     * the code is malformed, wrong, outside the window or not newer than $lastUsedStep.
     * Every candidate step is compared, so timing does not reveal which one matched.
     */
    public function verify(
        #[SensitiveParameter] string $secret,
        #[SensitiveParameter] string $code,
        ?int $lastUsedStep = null,
        ?int $timestamp = null,
    ): ?int {
        $code = preg_replace('/\s+/', '', $code) ?? '';

        if (preg_match('/\A\d{'.$this->digits.'}\z/', $code) !== 1) {
            return null;
        }

        $key = Base32::decode($secret);
        $current = $this->stepAt($timestamp ?? time());
        $matched = null;

        for ($offset = -$this->window; $offset <= $this->window; $offset++) {
            $step = $current + $offset;

            if ($step < 0) {
                continue;
            }

            if (hash_equals(self::hotp($key, $step, $this->digits), $code) && $matched === null) {
                $matched = $step;
            }
        }

        if ($matched === null || ($lastUsedStep !== null && $matched <= $lastUsedStep)) {
            return null;
        }

        return $matched;
    }

    /**
     * otpauth:// URI for the authenticator app (Key Uri Format). Built on the server and
     * rendered as an inline QR image; it never leaves the panel page.
     */
    public function provisioningUri(#[SensitiveParameter] string $secret, string $account, string $issuer): string
    {
        $label = rawurlencode($issuer).':'.rawurlencode($account);

        return 'otpauth://totp/'.$label.'?'.http_build_query([
            'secret' => $secret,
            'issuer' => $issuer,
            'algorithm' => 'SHA1',
            'digits' => $this->digits,
            'period' => $this->period,
        ], '', '&', PHP_QUERY_RFC3986);
    }

    /**
     * RFC 4226 HOTP value of a raw key and counter.
     */
    public static function hotp(#[SensitiveParameter] string $key, int $counter, int $digits = 6): string
    {
        $hash = hash_hmac('sha1', pack('J', $counter), $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | ((ord($hash[$offset + 1]) & 0xFF) << 16)
            | ((ord($hash[$offset + 2]) & 0xFF) << 8)
            | (ord($hash[$offset + 3]) & 0xFF);

        return str_pad((string) ($binary % (10 ** $digits)), $digits, '0', STR_PAD_LEFT);
    }
}
