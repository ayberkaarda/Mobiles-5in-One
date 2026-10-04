<?php

namespace App\Domain\Fraud\Jobs;

use App\Domain\Fraud\Services\FraudScanner;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * fraud.scan (hourly): the fraud budget scan. The payload carries no data.
 */
class ScanFraud implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = FraudScanner::NAME;

    public int $uniqueFor = 3300;

    public function handle(FraudScanner $scanner): void
    {
        $scanner->scan();
    }

    public function displayName(): string
    {
        return self::NAME;
    }
}
