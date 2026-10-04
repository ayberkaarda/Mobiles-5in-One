<?php

namespace App\Domain\Admin\Support;

use Symfony\Component\HttpFoundation\IpUtils;

/**
 * The admin IP allowlist (`ADMIN_IP_ALLOWLIST`): IPv4/IPv6 addresses and CIDR ranges.
 *
 * Fail closed: outside the local and testing environments an empty, missing, wrongly
 * typed or partly malformed list denies every address, so a forgotten variable cannot
 * leave the panel open. `*` as the only entry opens the panel to every address on
 * purpose. In local and testing an empty list means the check is off.
 */
final class IpAllowlist
{
    public const ANY = '*';

    /**
     * @param  list<string>  $entries
     */
    private function __construct(
        private readonly array $entries,
        private readonly bool $relaxed,
        private readonly bool $malformed,
    ) {}

    public static function fromConfig(): self
    {
        $raw = config('admin.ip_allowlist');
        $relaxed = app()->environment(['local', 'testing']);

        if (! is_array($raw)) {
            return new self([], $relaxed, true);
        }

        $entries = [];
        $malformed = false;

        foreach ($raw as $entry) {
            if (is_string($entry) && self::valid($entry)) {
                $entries[] = trim($entry);
            } else {
                $malformed = true;
            }
        }

        return new self($entries, $relaxed, $malformed);
    }

    /**
     * True when the list cannot be trusted to restrict anything and the panel is closed
     * for that reason (empty or malformed outside local and testing).
     */
    public function isMisconfigured(): bool
    {
        if ($this->relaxed) {
            return false;
        }

        return $this->entries === [] || $this->malformed;
    }

    public function isEnabled(): bool
    {
        return $this->entries !== [];
    }

    public function allows(?string $ip): bool
    {
        if ($this->isMisconfigured()) {
            return false;
        }

        if ($this->entries === []) {
            return true;
        }

        if ($this->entries === [self::ANY]) {
            return true;
        }

        if ($ip === null || $ip === '') {
            return false;
        }

        return IpUtils::checkIp($ip, array_values(array_filter($this->entries, static fn (string $e): bool => $e !== self::ANY)));
    }

    private static function valid(string $entry): bool
    {
        $entry = trim($entry);

        if ($entry === self::ANY) {
            return true;
        }

        $parts = explode('/', $entry, 2);
        $address = $parts[0];
        $prefix = $parts[1] ?? null;

        if (filter_var($address, FILTER_VALIDATE_IP) === false) {
            return false;
        }

        if ($prefix === null) {
            return true;
        }

        $max = str_contains($address, ':') ? 128 : 32;

        return ctype_digit($prefix) && (int) $prefix <= $max;
    }
}
