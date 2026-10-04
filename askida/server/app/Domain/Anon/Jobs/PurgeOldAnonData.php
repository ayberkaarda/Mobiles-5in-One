<?php

namespace App\Domain\Anon\Jobs;

use App\Domain\Anon\Services\AnonRetentionService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

/**
 * Scheduled daily as `anon.purge-old`.
 */
final class PurgeOldAnonData implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function handle(AnonRetentionService $retention): void
    {
        Log::info('anon.purge-old', $retention->purge());
    }
}
