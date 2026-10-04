<?php

namespace App\Policies;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\Ability;
use App\Domain\Donations\Models\Donation;
use App\Models\User;
use App\Policies\Concerns\AuthorizesActors;
use Illuminate\Auth\Access\Response;

/**
 * Authorization matrix section 3.3. Donations are donor data: no merchant, anon device
 * or admin role reads another donor's donation through the API.
 */
class DonationPolicy
{
    use AuthorizesActors;

    /**
     * POST donations: donor ability; `donor_id` is always the token's user.
     */
    public function create(User|AnonDevice $actor): Response
    {
        return $this->allowWhen($this->hasAbility($actor, Ability::Donor));
    }

    /**
     * GET donations: donor ability; the query is scoped to `donor_id = token user`.
     */
    public function viewAny(User|AnonDevice $actor): Response
    {
        return $this->allowWhen($this->hasAbility($actor, Ability::Donor));
    }

    /**
     * GET donations/{id}: only the donor who made it; another donor's donation looks
     * missing.
     */
    public function view(User|AnonDevice $actor, Donation $donation): Response
    {
        if (! $actor instanceof User || ! $this->hasAbility($actor, Ability::Donor)) {
            return $this->forbidden();
        }

        $donorId = $donation->getAttribute('donor_id');

        return $donorId !== null && $donorId === $actor->getKey()
            ? Response::allow()
            : $this->notFoundForCaller();
    }
}
