<?php

namespace App\Providers;

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\URL;
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
        // URLs built by the application always use https outside local development and tests.
        if (! $this->app->environment('local', 'testing')) {
            URL::forceScheme('https');
        }

        // `<script @nonce>` prints the CSP nonce of the current request (empty when none).
        Blade::directive('nonce', static fn (): string => '<?php if (\Illuminate\Support\Facades\Vite::cspNonce() !== null): ?>nonce="<?php echo e(\Illuminate\Support\Facades\Vite::cspNonce()); ?>"<?php endif; ?>');
    }
}
