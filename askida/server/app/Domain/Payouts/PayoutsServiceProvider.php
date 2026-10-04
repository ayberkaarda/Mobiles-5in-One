<?php

namespace App\Domain\Payouts;

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Fraud\Console\ScanFraudCommand;
use App\Domain\Payouts\Console\SyncPayoutsCommand;
use App\Domain\Payouts\Services\PanelPayoutHolds;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Listeners\OnboardSubMerchantOnVerified;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/**
 * Payouts and fraud area: sub-merchant onboarding on verification, the settlement sync
 * and the fraud scan commands, and the panel's payout hold and release. Their schedules live in routes/console.php.
 */
class PayoutsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // The panel's hold and release actions (authorized, transactional).
        $this->app->bind(HoldsPayouts::class, PanelPayoutHolds::class);
    }

    public function boot(): void
    {
        Event::listen(ShopVerified::class, OnboardSubMerchantOnVerified::class);

        if ($this->app->runningInConsole()) {
            $this->commands([SyncPayoutsCommand::class, ScanFraudCommand::class]);
        }
    }
}
