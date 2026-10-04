<?php

namespace App\Domain\Shops\Validation;

use App\Domain\Shops\Support\TurkishIban;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Turkish IBAN that passes the mod-97 check. Reported as `iban_checksum`.
 */
final class IbanChecksum implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! TurkishIban::isValid($value)) {
            $fail('The IBAN is invalid.');
        }
    }
}
