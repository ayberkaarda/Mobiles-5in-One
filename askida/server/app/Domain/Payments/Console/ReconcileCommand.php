<?php

namespace App\Domain\Payments\Console;

use App\Domain\Payments\Jobs\ReconcilePayments;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Throwable;

/**
 * Runs the reconciliation now, in this process. `--since` widens or narrows the window
 * (any date the framework can parse, Europe/Istanbul when no offset is given).
 */
final class ReconcileCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'payments:reconcile
        {--since= : Start of the window (default: 48 hours ago)}';

    /**
     * @var string
     */
    protected $description = 'Compare recent donations with the payment provider and record mismatches';

    public function handle(): int
    {
        $option = $this->option('since');
        $since = null;

        if (is_string($option) && trim($option) !== '') {
            try {
                $since = CarbonImmutable::parse($option, 'Europe/Istanbul');
            } catch (Throwable) {
                $this->error('The --since value is not a valid date.');

                return self::FAILURE;
            }

            if ($since->isFuture()) {
                $this->error('The --since value lies in the future.');

                return self::FAILURE;
            }
        }

        /** @var array{checked: int, fixed: int, mismatches: int, unavailable: int} $summary */
        $summary = $this->laravel->call([new ReconcilePayments($since), 'handle']);

        $this->info(sprintf(
            'checked %d, fixed %d, new mismatches %d, provider unavailable %d',
            $summary['checked'],
            $summary['fixed'],
            $summary['mismatches'],
            $summary['unavailable'],
        ));

        return $summary['unavailable'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
