<?php

namespace App\Domain\Payouts\Jobs;

use App\Domain\Payouts\Services\PayoutSynchronizer;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * payouts.sync (every 6 hours): mirrors the provider's settlements of the last 14 days
 * into `payouts`. The payload carries no data.
 */
class SyncPayouts implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = PayoutSynchronizer::NAME;

    public int $uniqueFor = 3600;

    public function handle(PayoutSynchronizer $synchronizer): void
    {
        $synchronizer->syncAll();
    }

    public function displayName(): string
    {
        return self::NAME;
    }
}
