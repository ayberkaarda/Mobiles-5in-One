<?php

namespace App\Support\Logging;

use Illuminate\Contracts\Support\Arrayable;
use JsonSerializable;
use Monolog\LogRecord;
use Monolog\Processor\ProcessorInterface;
use Stringable;
use Throwable;

/**
 * Security checklist item 14: masks personal data and credentials in every log record
 * (message, context, extra, exceptions) before any handler formats or writes it.
 *
 * - values under keys that look sensitive (password, token, secret, code, authorization,
 *   cookie, iban, tax ...) are replaced as a whole, at any nesting depth;
 *
 * - inside free text: e-mail addresses (a***@d***.tld), Authorization/Cookie header values,
 *   bearer tokens, key=value credentials, IBANs (TR and generic), tax numbers after a
 *   keyword, card-like 13-19 digit runs and Turkish phone numbers.
 *
 * Applying the processor twice gives the same result as applying it once, so a record
 * that passes through several channels of a stack is not mangled.
 */
final class MaskingProcessor implements ProcessorInterface
{
    public const REDACTED = '[redacted]';

    private const SENSITIVE_KEY = '/password|passwd|token|secret|code|authorization|cookie|iban|tax/i';

    private const REQUEST_ID_KEY = 'request_id';

    private const REQUEST_ID_PATTERN = '/^[A-Za-z0-9._-]{8,64}$/';

    private const MAX_DEPTH = 8;

    /**
     * Ordered: credentials first, then structured numbers (IBAN, card, tax) before the
     * looser phone pattern, so the most specific placeholder wins.
     *
     * @var array<string, string>
     */
    private const TEXT_RULES = [
        // Authorization / Cookie / Set-Cookie header values, in "Name: value" or JSON form.
        '/\b((?:proxy-)?authorization|set-cookie|cookie)(["\']?\s*[:=]\s*)(["\']?)[^\r\n"\']*/i' => '$1$2$3'.self::REDACTED,
        // Bearer tokens anywhere.
        '/\bBearer\s+[A-Za-z0-9._~+\/=-]+/i' => 'Bearer '.self::REDACTED,
        // key=value or "key": "value" pairs whose key looks like a credential.
        '/\b([A-Za-z0-9_-]*(?:password|passwd|token|secret|api_key|code|iban|tax)[A-Za-z0-9_-]*)(["\']?\s*[:=]\s*)(["\']?)(?!\[)[^\s"\'&,;}\]]+/i' => '$1$2$3'.self::REDACTED,
        // E-mail addresses: first character of the local part and of the domain, keep the TLD.
        '/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9])[A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,})\b/' => '$1***@$2***.$3',
        // Turkish IBAN (26 characters, spaces allowed every four).
        '/\bTR\d{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{2}\b/i' => '[iban]',
        // Other IBANs (ISO 13616: 15-34 characters).
        '/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/' => '[iban]',
        // Tax / national id numbers (10 or 11 digits) after a keyword.
        '/\b(vkn|tckn|tc\s?kimlik(?:\s?no)?|vergi\s?(?:no|numaras[ıi])|tax[\s_-]?(?:number|no|id))(\W{1,3})\d{10,11}\b/iu' => '$1$2[tax]',
        // Card-like runs of 13-19 digits, optionally grouped by spaces or dashes.
        '/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/' => '[card]',
        // Turkish phone numbers: +90 / 0090 / 0 prefix optional, mobile and landline.
        '/(?<![\d+])(?:(?:\+90|0090|0)[\s.-]?)?\(?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/' => '[phone]',
    ];

    public function __invoke(LogRecord $record): LogRecord
    {
        return $record->with(
            message: self::maskText($record->message),
            context: self::maskArray($record->context),
            extra: self::maskArray($record->extra),
        );
    }

    public static function maskText(string $text): string
    {
        foreach (self::TEXT_RULES as $pattern => $replacement) {
            $text = (string) preg_replace($pattern, $replacement, $text);
        }

        return $text;
    }

    /**
     * @param  array<array-key, mixed>  $data
     * @return array<array-key, mixed>
     */
    public static function maskArray(array $data, int $depth = 0): array
    {
        $masked = [];

        foreach ($data as $key => $value) {
            if (is_string($key) && preg_match(self::SENSITIVE_KEY, $key) === 1) {
                $masked[$key] = self::REDACTED;

                continue;
            }

            if ($key === self::REQUEST_ID_KEY && is_string($value) && preg_match(self::REQUEST_ID_PATTERN, $value) === 1) {
                $masked[$key] = $value;

                continue;
            }

            $masked[$key] = self::maskValue($value, $depth + 1);
        }

        return $masked;
    }

    private static function maskValue(mixed $value, int $depth): mixed
    {
        if ($depth > self::MAX_DEPTH) {
            return self::REDACTED;
        }

        return match (true) {
            is_string($value) => self::maskText($value),
            is_int($value) && strlen((string) abs($value)) >= 10 => self::maskText((string) $value),
            is_array($value) => self::maskArray($value, $depth),
            $value instanceof Throwable => self::maskThrowable($value),
            $value instanceof JsonSerializable => self::maskValue($value->jsonSerialize(), $depth + 1),
            $value instanceof Arrayable => self::maskArray($value->toArray(), $depth),
            $value instanceof Stringable => self::maskText((string) $value),
            is_object($value) => '[object '.$value::class.']',
            default => $value,
        };
    }

    /**
     * The exception becomes text with its message, location and trace masked; the
     * previous exceptions follow.
     */
    private static function maskThrowable(Throwable $e): string
    {
        $parts = [];

        for ($current = $e, $level = 0; $current !== null && $level < 5; $current = $current->getPrevious(), $level++) {
            $parts[] = sprintf(
                "%s%s: %s at %s:%d\n%s",
                $level === 0 ? '' : 'Caused by: ',
                $current::class,
                self::maskText($current->getMessage()),
                $current->getFile(),
                $current->getLine(),
                self::maskText($current->getTraceAsString()),
            );
        }

        return implode("\n", $parts);
    }
}
