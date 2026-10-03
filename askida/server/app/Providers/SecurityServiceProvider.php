<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * Security glue: debug output, headers, HTTPS and logging defaults.
 */
class SecurityServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Detailed error pages exist only on a developer machine.
        if (! $this->app->environment('local')) {
            config(['app.debug' => false]);
        }
    }

    public function boot(): void
    {
        //
    }
}
