<?php

namespace App\Domain\Accounts\Jobs;

use App\Domain\Accounts\Services\AccountDeletionService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;

/**
 * accounts.hard-delete (hourly): erases the personal data of every deletion request
 * whose grace period is over. The payload carries no data at all.
 */
class HardDeleteAccounts implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = 'accounts.hard-delete';

    public int $uniqueFor = 3600;

    public function handle(AccountDeletionService $deletions): void
    {
        $summary = $deletions->hardDeleteDue();

        Log::info(self::NAME, $summary);
    }

    public function displayName(): string
    {
        return self::NAME;
    }
}
