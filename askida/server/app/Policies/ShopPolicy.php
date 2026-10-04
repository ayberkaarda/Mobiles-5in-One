<?php

namespace App\Policies;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use App\Policies\Concerns\AuthorizesActors;
use Illuminate\Auth\Access\Response;

/**
 * Authorization matrix section 3.2 (shops).
 */
class ShopPolicy
{
    use AuthorizesActors;

    /**
     * GET shops: any of the three API abilities; guests never (decision D-1).
     */
    public function viewAny(User|AnonDevice $actor): Response
    {
        return $this->allowWhen($this->hasAnyApiAbility($actor));
    }

    /**
     * GET shops/{slug}: a verified shop for every API ability, an unverified shop only
     * for its members; anything else looks missing.
     */
    public function view(User|AnonDevice $actor, Shop $shop): Response
    {
        if (! $this->hasAnyApiAbility($actor)) {
            return $this->forbidden();
        }

        if ($shop->verification_state === ShopVerificationState::Verified) {
            return Response::allow();
        }

        if ($actor instanceof User && $this->hasAbility($actor, Ability::Merchant) && $this->memberRole($actor, $shop) !== null) {
            return Response::allow();
        }

        return $this->notFoundForCaller();
    }

    /**
     * POST shops: merchant ability. A merchant account that is staff of any shop is an
     * employee account and cannot open shops of its own (matrix: staff column `-`).
     */
    public function create(User|AnonDevice $actor): Response
    {
        if (! $actor instanceof User || ! $this->hasAbility($actor, Ability::Merchant)) {
            return $this->forbidden();
        }

        $isStaffSomewhere = ShopMember::query()
            ->where('user_id', $actor->getKey())
            ->where('role', ShopMemberRole::Staff->value)
            ->exists();

        return $this->allowWhen(! $isStaffSomewhere);
    }

    /**
     * PATCH shops/{id}: owner of the shop.
     */
    public function update(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->ownerOf($actor, $shop);
    }

    private function hasAnyApiAbility(User|AnonDevice $actor): bool
    {
        return $this->hasAbility($actor, Ability::Donor)
            || $this->hasAbility($actor, Ability::Merchant)
            || $this->hasAbility($actor, Ability::Anon);
    }
}
