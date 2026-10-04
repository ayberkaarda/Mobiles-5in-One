<?php

namespace App\Domain\Anon\Attestation;

/**
 * Small checks shared by the provider adapters: endpoints must be HTTPS, required
 * settings must be present, PEM keys may arrive with escaped line breaks from the
 * environment.
 */
final class ProviderConfig
{
    public static function httpsUrl(mixed $url): string
    {
        if (! is_string($url) || parse_url($url, PHP_URL_SCHEME) !== 'https' || parse_url($url, PHP_URL_HOST) === null) {
            throw new AttestationUnavailable('Attestation endpoints must use HTTPS.');
        }

        return $url;
    }

    public static function required(mixed $value, string $name): string
    {
        if (! is_string($value) || trim($value) === '') {
            throw new AttestationUnavailable("Attestation setting {$name} is not configured.");
        }

        return trim($value);
    }

    public static function pem(mixed $value, string $name): string
    {
        return str_replace('\n', "\n", self::required($value, $name));
    }
}
