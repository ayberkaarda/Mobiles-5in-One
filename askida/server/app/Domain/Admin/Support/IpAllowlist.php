<?php

namespace App\Domain\Admin\Support;

use Symfony\Component\HttpFoundation\IpUtils;

/**
 * The optional admin IP allowlist (`ADMIN_IP_ALLOWLIST`): IPv4/IPv6 addresses and CIDR
 * ranges. An empty list means the check is off.
 */
final class IpAllowlist
{
    /**
     * @param  list<string>  $entries
     */
    public function __construct(private readonly array $entries) {}

    public static function fromConfig(): self
    {
        $entries = config('admin.ip_allowlist', []);

        return new self(is_array($entries) ? array_values(array_filter($entries, 'is_string')) : []);
    }

    public function isEnabled(): bool
    {
        return $this->entries !== [];
    }

    public function allows(?string $ip): bool
    {
        if (! $this->isEnabled()) {
            return true;
        }

        if ($ip === null || $ip === '') {
            return false;
        }

        return IpUtils::checkIp($ip, $this->entries);
    }
}
