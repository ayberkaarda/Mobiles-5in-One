<?php

namespace App\Domain\Auth\Passwords;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Rejects passwords found in known breaches (validation error code `uncompromised`).
 */
final class Uncompromised implements ValidationRule
{
    public function __construct(private readonly BreachedPasswordChecker $checker) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && $this->checker->isBreached($value)) {
            $fail('The password appears in a known data breach.');
        }
    }
}
