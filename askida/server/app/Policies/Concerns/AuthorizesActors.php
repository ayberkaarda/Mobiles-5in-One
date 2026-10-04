<?php

namespace App\Policies\Concerns;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use Illuminate\Auth\Access\Response;

/**
 * Shared rules of the API policies.
 *
 * Actors are a `User` (donor or merchant token) or an `AnonDevice` (anon token). Admin
 * roles are never consulted here: admin access is a separate set of gates.
 *
 * Denial convention (see the authorization matrix, section 2):
 * 1. The token's ability cannot use the action at all: 403 `forbidden`, decided before
 *    any lookup of the target, so it leaks nothing.
 * 2. The ability fits but the target is outside the caller's scope (another merchant's
 *    shop, another donor's donation, a document): 404 `not_found` through
 *    notFoundForCaller(), identical to a missing id.
 * 3. The caller is inside the scope and can legitimately know the resource, but its
 *    role lacks the action (staff on an owner-only change): 403 `forbidden`.
 */
trait AuthorizesActors
{
    /**
     * Runs before every policy method. It only ever denies (deactivated users, banned
     * anon devices); it never grants, so no role bypasses ownership or anonymity.
     */
    public function before(User|AnonDevice $actor, string $ability): ?bool
    {
        if ($actor instanceof User && $actor->isDeactivated()) {
            return false;
        }

        if ($actor instanceof AnonDevice && $actor->banned_at !== null) {
            return false;
        }

        return null;
    }

    /**
     * True when the actor is a user of the matching kind whose current token carries
     * the ability. A user without a token (for example a panel session) has none.
     */
    protected function hasAbility(User|AnonDevice $actor, Ability $ability): bool
    {
        if ($ability === Ability::Anon) {
            return $actor instanceof AnonDevice;
        }

        return $actor instanceof User
            && $actor->kind->ability() === $ability->value
            && $actor->tokenCan($ability->value);
    }

    protected function memberRole(User $user, Shop $shop): ?ShopMemberRole
    {
        $role = ShopMember::query()
            ->where('shop_id', $shop->getKey())
            ->where('user_id', $user->getKey())
            ->value('role');

        return match (true) {
            $role instanceof ShopMemberRole => $role,
            is_string($role) => ShopMemberRole::tryFrom($role),
            default => null,
        };
    }

    /**
     * Owner-only action on a shop: merchant ability, then membership, then role.
     */
    protected function ownerOf(User|AnonDevice $actor, Shop $shop): Response
    {
        if (! $actor instanceof User || ! $this->hasAbility($actor, Ability::Merchant)) {
            return $this->forbidden();
        }

        return match ($this->memberRole($actor, $shop)) {
            ShopMemberRole::Owner => Response::allow(),
            ShopMemberRole::Staff => $this->forbidden(),
            null => $this->notFoundForCaller(),
        };
    }

    /**
     * Action open to every member (owner or staff) of the shop.
     */
    protected function memberOf(User|AnonDevice $actor, Shop $shop): Response
    {
        if (! $actor instanceof User || ! $this->hasAbility($actor, Ability::Merchant)) {
            return $this->forbidden();
        }

        return $this->memberRole($actor, $shop) === null
            ? $this->notFoundForCaller()
            : Response::allow();
    }

    protected function allowWhen(bool $condition): Response
    {
        return $condition ? Response::allow() : $this->forbidden();
    }

    protected function forbidden(): Response
    {
        return Response::deny(ProblemCode::Forbidden->title(), ProblemCode::Forbidden->value)->withStatus(403);
    }

    /**
     * The caller may not learn that the resource exists: the denial renders exactly
     * like a missing id (404 `not_found`).
     */
    protected function notFoundForCaller(): Response
    {
        return Response::denyAsNotFound(ProblemCode::NotFound->title(), ProblemCode::NotFound->value);
    }
}
