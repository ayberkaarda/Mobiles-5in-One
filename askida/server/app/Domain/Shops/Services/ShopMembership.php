<?php

namespace App\Domain\Shops\Services;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;

/**
 * Reads a user's role in one shop from `shop_members` (never from the token).
 */
final class ShopMembership
{
    public function roleOf(User $user, Shop $shop): ?ShopMemberRole
    {
        $member = ShopMember::query()
            ->where('shop_id', $shop->getKey())
            ->where('user_id', $user->getKey())
            ->first();

        return $member?->role;
    }

    public function isOwner(User $user, Shop $shop): bool
    {
        return $this->roleOf($user, $shop) === ShopMemberRole::Owner;
    }
}
