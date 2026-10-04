<?php

namespace App\Domain\Hooks\Codes;

use RuntimeException;

/**
 * `hooks.code_hash` = lowercase hex HMAC-SHA256 of the normalised code keyed with
 * HOOK_CODE_PEPPER. The pepper lives only in the server environment, so a database
 * dump alone does not allow testing the 2^40 code space offline.
 */
class HookCodeHasher
{
    public const MIN_PEPPER_LENGTH = 32;

    /** The published local development value of `.env.example`; refused outside local and testing. */
    public const EXAMPLE_PEPPER = 'local-development-pepper-not-a-secret';

    public function __construct(private readonly ?string $pepper) {}

    public function hash(string $normalisedCode): string
    {
        return hash_hmac('sha256', $normalisedCode, self::requirePepper($this->pepper));
    }

    /**
     * @throws RuntimeException when the pepper is missing or too short
     */
    public static function requirePepper(mixed $pepper): string
    {
        if (! is_string($pepper) || strlen(trim($pepper)) < self::MIN_PEPPER_LENGTH) {
            throw new RuntimeException('HOOK_CODE_PEPPER must be set to at least '.self::MIN_PEPPER_LENGTH.' characters.');
        }

        return $pepper;
    }
}
