<?php

namespace App\Domain\Payouts\Console;

use App\Domain\Payouts\Services\PayoutSynchronizer;
use Illuminate\Console\Command;

/**
 * php artisan payouts:sync: runs the settlement sync now and prints the counters.
 */
class SyncPayoutsCommand extends Command
{
    protected $signature = 'payouts:sync';

    protected $description = 'Mirror the provider settlements of the last 14 days into payouts';

    public function handle(PayoutSynchronizer $synchronizer): int
    {
        $summary = $synchronizer->syncAll();

        $this->table(array_keys($summary), [array_values($summary)]);

        return self::SUCCESS;
    }
}
