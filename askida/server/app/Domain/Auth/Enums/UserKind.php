<?php

namespace App\Domain\Auth\Enums;

/**
 * Account kind, chosen once at sign-up. It also names the single Sanctum token ability.
 */
enum UserKind: string
{
    case Donor = 'donor';
    case Merchant = 'merchant';

    public function ability(): string
    {
        return $this->value;
    }
}
