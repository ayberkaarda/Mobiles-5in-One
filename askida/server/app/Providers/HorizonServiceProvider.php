<?php

namespace App\Providers;

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
     * Outside the local environment nobody may open the dashboard until the
     * admin roles exist; access is then granted to the admin role only.
     */
    protected function gate(): void
    {
        Gate::define('viewHorizon', function ($user = null) {
            return false;
        });
    }
}
