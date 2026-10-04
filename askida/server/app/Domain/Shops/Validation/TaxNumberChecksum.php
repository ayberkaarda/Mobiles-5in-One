<?php

namespace App\Domain\Shops\Validation;

use App\Domain\Shops\Support\TurkishTaxNumber;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Ten-digit VKN with a valid check digit. Reported as `tax_number_checksum`.
 */
final class TaxNumberChecksum implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! TurkishTaxNumber::isValid($value)) {
            $fail('The tax number is invalid.');
        }
    }
}
