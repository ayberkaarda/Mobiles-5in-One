<?php

namespace App\Domain\Payouts;

use App\Domain\Fraud\Console\ScanFraudCommand;
use App\Domain\Payouts\Console\SyncPayoutsCommand;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Listeners\OnboardSubMerchantOnVerified;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/**
 * Payouts and fraud area: sub-merchant onboarding on verification, the settlement sync
 * and the fraud scan commands. Their schedules live in routes/console.php.
 */
class PayoutsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Event::listen(ShopVerified::class, OnboardSubMerchantOnVerified::class);

        if ($this->app->runningInConsole()) {
            $this->commands([SyncPayoutsCommand::class, ScanFraudCommand::class]);
        }
    }
}
