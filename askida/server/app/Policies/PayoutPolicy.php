<?php

namespace App\Policies;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use App\Policies\Concerns\AuthorizesActors;
use Illuminate\Auth\Access\Response;

/**
 * Authorization matrix section 3.5. Called as `authorize('viewAny', [Payout::class, $shop])`.
 * There is no payout write action on the API.
 */
class PayoutPolicy
{
    use AuthorizesActors;

    /**
     * GET shops/{id}/payouts: owner of the shop.
     */
    public function viewAny(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->ownerOf($actor, $shop);
    }
}
