<?php

namespace App\Domain\Shops\Models;

/**
 * Role of a user inside one shop. Staff may redeem codes and view redemptions only.
 */
enum ShopMemberRole: string
{
    case Owner = 'owner';
    case Staff = 'staff';
}
