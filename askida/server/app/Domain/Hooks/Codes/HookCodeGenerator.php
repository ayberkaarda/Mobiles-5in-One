<?php

namespace App\Domain\Hooks\Codes;

/**
 * Draws a new redemption code from the CSPRNG (`random_int`), uniformly over the
 * alphabet.
 */
class HookCodeGenerator
{
    public function generate(): string
    {
        $last = strlen(HookCode::ALPHABET) - 1;
        $code = '';

        for ($i = 0; $i < HookCode::LENGTH; $i++) {
            $code .= HookCode::ALPHABET[random_int(0, $last)];
        }

        return $code;
    }
}
