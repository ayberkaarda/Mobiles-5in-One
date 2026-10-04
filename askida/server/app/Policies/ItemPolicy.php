<?php

namespace App\Policies;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use App\Policies\Concerns\AuthorizesActors;
use Illuminate\Auth\Access\Response;

/**
 * Authorization matrix section 3.2 (catalog). Called as
 * `authorize('viewAny', [Item::class, $shop])`, `authorize('create', [Item::class, $shop])`
 * and `authorize('update', [$item, $shop])`.
 */
class ItemPolicy
{
    use AuthorizesActors;

    /**
     * GET shops/{id}/items: owner or staff of the shop (the full catalog, inactive items
     * included); a non-member sees a missing shop.
     */
    public function viewAny(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->memberOf($actor, $shop);
    }

    /**
     * POST shops/{id}/items: owner of the shop.
     */
    public function create(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->ownerOf($actor, $shop);
    }

    /**
     * PATCH shops/{id}/items/{itemId}: owner of the shop, and the item must belong to
     * that shop; an item of another shop looks missing.
     */
    public function update(User|AnonDevice $actor, Item $item, Shop $shop): Response
    {
        if (! $this->hasAbility($actor, Ability::Merchant)) {
            return $this->forbidden();
        }

        if ($item->getAttribute('shop_id') !== $shop->getKey()) {
            return $this->notFoundForCaller();
        }

        return $this->ownerOf($actor, $shop);
    }
}
