<?php

use App\Domain\Accounts\Jobs\HardDeleteAccounts;
use App\Domain\Impact\Jobs\TakeImpactSnapshot;
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
