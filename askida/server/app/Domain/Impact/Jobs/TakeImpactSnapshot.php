<?php

namespace App\Domain\Impact\Jobs;

use App\Domain\Impact\Services\ImpactSnapshotService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Carbon;

/**
 * impact.snapshot (hourly): recomputes today's district counters and closes yesterday's,
 * so units counted shortly before midnight are not lost.
 */
class TakeImpactSnapshot implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = 'impact.snapshot';

    public int $uniqueFor = 3600;

    public function handle(ImpactSnapshotService $snapshots): void
    {
        $today = Carbon::now();

        $snapshots->snapshot($today->copy()->subDay());
        $snapshots->snapshot($today);
    }

    public function displayName(): string
    {
        return self::NAME;
    }
}
