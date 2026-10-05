<?php

namespace App\Domain\Cost;

use App\Console\Commands\RotateAppKey;
use App\Domain\Cost\Listeners\EnforceMailBudget;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/**
 * Cost guards: the send budget (mail listener, push job check) and the app key rotation
 * command. The cost.guard schedule lives in routes/console.php.
 */
class CostServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(SendBudget::class);
    }

    public function boot(): void
    {
        Event::listen(MessageSending::class, EnforceMailBudget::class);

        if ($this->app->runningInConsole()) {
            $this->commands([RotateAppKey::class]);
        }
    }
}
