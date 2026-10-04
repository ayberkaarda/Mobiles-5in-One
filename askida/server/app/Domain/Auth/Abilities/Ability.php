<?php

namespace App\Domain\Auth\Abilities;

/**
 * Sanctum token abilities. They mirror the API principals and are mutually exclusive
 * on one token: a user token carries exactly the ability of `users.kind`, an anon
 * device token carries `anon`. Owner and staff are never token abilities; they are
 * read from `shop_members` on every request.
 */
enum Ability: string
{
    case Donor = 'donor';
    case Merchant = 'merchant';
    case Anon = 'anon';
}
