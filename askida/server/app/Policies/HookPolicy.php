<?php

namespace App\Policies;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use App\Policies\Concerns\AuthorizesActors;
use Illuminate\Auth\Access\Response;

/**
 * Authorization matrix section 3.4 and the hook row of section 4. Called as
 * `authorize('reserve', Hook::class)`, `authorize('redeem', [Hook::class, $shop])`.
 */
class HookPolicy
{
    use AuthorizesActors;

    /**
     * POST hooks/reserve: anon devices only (not banned, checked in before()); the
     * `anon_id` always comes from the token.
     */
    public function reserve(User|AnonDevice $actor): Response
    {
        return $this->allowWhen($this->hasAbility($actor, Ability::Anon));
    }

    /**
     * POST shops/{id}/redeem: owner or staff of the shop.
     */
    public function redeem(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->memberOf($actor, $shop);
    }

    /**
     * GET shops/{id}/redemptions: owner or staff of the shop.
     */
    public function viewRedemptions(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->memberOf($actor, $shop);
    }

    /**
     * Editing a hook's status or code by hand is not possible for anyone, admin
     * included: transitions happen only through reserve, redeem and the expiry job.
     */
    public function update(User|AnonDevice $actor, Hook $hook): Response
    {
        return $this->forbidden();
    }
}
