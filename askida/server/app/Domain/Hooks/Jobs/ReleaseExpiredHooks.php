<?php

namespace App\Domain\Hooks\Jobs;

use App\Domain\Hooks\Services\HookReleaseService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

/**
 * Scheduled every minute as `hooks.release-expired`. Safe to run in parallel with
 * itself and with reserve/redeem (see HookReleaseService).
 */
final class ReleaseExpiredHooks implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function handle(HookReleaseService $release): void
    {
        $released = $release->releaseExpired();

        if ($released > 0) {
            Log::info('hooks.release-expired', ['released' => $released]);
        }
    }
}
