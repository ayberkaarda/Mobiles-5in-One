<?php

namespace App\Domain\Fraud\Console;

use App\Domain\Fraud\Services\FraudScanner;
use Illuminate\Console\Command;

/**
 * php artisan fraud:scan: runs the fraud budget scan now and prints the counters.
 */
class ScanFraudCommand extends Command
{
    protected $signature = 'fraud:scan';

    protected $description = 'Hold the pending payouts of shops above the fraud thresholds and flag them to finance';

    public function handle(FraudScanner $scanner): int
    {
        $summary = $scanner->scan();

        $this->table(array_keys($summary), [array_values($summary)]);

        return self::SUCCESS;
    }
}
