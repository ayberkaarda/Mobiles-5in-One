<?php

use App\Domain\Accounts\Jobs\HardDeleteAccounts;
use App\Domain\Anon\Jobs\PurgeOldAnonData;
use App\Domain\Fraud\Jobs\ScanFraud;
use App\Domain\Hooks\Jobs\ReleaseExpiredHooks;
use App\Domain\Impact\Jobs\TakeImpactSnapshot;
use App\Domain\Payments\Jobs\ReconcilePayments;
use App\Domain\Payouts\Jobs\SyncPayouts;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Account deletion: erase personal data once the grace period is over.
Schedule::job(new HardDeleteAccounts)->hourly()->name(HardDeleteAccounts::NAME)->withoutOverlapping()->onOneServer();

// Public impact counters (district level, counts only).
Schedule::job(new TakeImpactSnapshot)->hourly()->name(TakeImpactSnapshot::NAME)->withoutOverlapping()->onOneServer();
// Reservations not redeemed in time go back to the pool (reserve and redeem also
// release lazily, so correctness never waits for this job).
Schedule::job(new ReleaseExpiredHooks)
    ->name('hooks.release-expired')
    ->everyMinute()
    ->withoutOverlapping()
    ->onOneServer();

// Recipient-linked data older than the retention window (rule AN-6).
Schedule::job(new PurgeOldAnonData)
    ->name('anon.purge-old')
    ->dailyAt('03:15')
    ->timezone('Europe/Istanbul')
    ->onOneServer();

// region payments reconciliation
// Compare recent donations with the payment provider, fix missed transitions through the
// settlement service and alert finance about disagreements (security items 17 and 22).
Schedule::job(new ReconcilePayments)
    ->name(ReconcilePayments::NAME)
    ->dailyAt('04:10')
    ->timezone('Europe/Istanbul')
    ->withoutOverlapping()
    ->onOneServer();
// endregion payments reconciliation

// region payouts
// Provider settlements of the last 14 days mirrored into payouts.
Schedule::job(new SyncPayouts)
    ->name(SyncPayouts::NAME)
    ->everySixHours()
    ->withoutOverlapping()
    ->onOneServer();

// Fraud budget: hold the pending payouts of shops above the anomaly thresholds.
Schedule::job(new ScanFraud)
    ->name(ScanFraud::NAME)
    ->hourly()
    ->withoutOverlapping()
    ->onOneServer();
// endregion payouts

// region backups
// Security item 20 (config/backup.php, docs/ops/backup-restore.md): prune by the retention
// rules, then write tonight's encrypted archive, then check that the newest one is fresh.
Schedule::command('backup:clean')
    ->dailyAt('03:00')
    ->timezone('Europe/Istanbul')
    ->withoutOverlapping()
    ->onOneServer();

Schedule::command('backup:run')
    ->dailyAt('03:30')
    ->timezone('Europe/Istanbul')
    ->withoutOverlapping()
    ->onOneServer();

Schedule::command('backup:monitor')
    ->dailyAt('04:00')
    ->timezone('Europe/Istanbul')
    ->onOneServer();
// endregion backups
