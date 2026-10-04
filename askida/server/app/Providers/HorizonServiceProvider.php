<?php

namespace App\Providers;

use App\Domain\Auth\Abilities\AdminAccess;
use App\Domain\Auth\Abilities\AdminPermission;
use Illuminate\Support\Facades\Gate;
use Laravel\Horizon\HorizonApplicationServiceProvider;

class HorizonServiceProvider extends HorizonApplicationServiceProvider
{
    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        parent::boot();
    }

    /**
     * Register the Horizon gate.
     *
     * Outside the local environment only a panel session of the admin role (permission
     * horizon.view) may open the dashboard.
     */
    protected function gate(): void
    {
        Gate::define('viewHorizon', static fn (mixed $user = null): bool => AdminAccess::allows($user, AdminPermission::ViewHorizon));
    }
}
