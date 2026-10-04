<?php

/*
| A participant of the concurrency scenarios, run as its own OS process by
| ConcurrencyHarness. It boots the application once against the test database, says
| "ready", then serves jobs: one JSON job per stdin line, one JSON result per stdout
| line. For each job it waits at the start barrier (a shared advisory lock that the
| harness holds exclusively until every participant waits on it), runs one engine
| operation and reports the outcome. An empty line or end of input stops it.
*/

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Services\HookIssuer;
use App\Domain\Hooks\Services\HookRedemptionService;
use App\Domain\Hooks\Services\HookReleaseService;
use App\Domain\Hooks\Services\HookReservationService;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
DB::select('select 1');

fwrite(STDOUT, "ready\n");

/**
 * @param  array{scenario: string, lock_key: int, pepper: string, now?: string|null, args: array<string, string>}  $job
 * @return array<string, mixed>
 */
function runJob(array $job): array
{
    config(['askida.hook_code_pepper' => $job['pepper']]);
    $now = $job['now'] ?? null;
    Carbon::setTestNow($now === null ? null : Carbon::parse($now));
    CarbonImmutable::setTestNow($now === null ? null : CarbonImmutable::parse($now));
    $args = $job['args'];

    DB::select('select pg_advisory_lock_shared(?)', [$job['lock_key']]);

    try {
        return ['ok' => true] + match ($job['scenario']) {
            'reserve' => ['hook_id' => app(HookReservationService::class)->reserve(
                AnonDevice::query()->where('anon_id', $args['anon_id'])->firstOrFail(),
                $args['shop_id'],
                $args['item_id'],
            )->hookId],
            'redeem' => ['hook_id' => app(HookRedemptionService::class)->redeem(
                Shop::query()->findOrFail($args['shop_id']),
                User::query()->findOrFail($args['user_id']),
                $args['code'],
            )->hookId],
            'release' => ['released' => app(HookReleaseService::class)->releaseExpired()],
            'issue' => ['created' => app(HookIssuer::class)->issueForDonation(Donation::query()->findOrFail($args['donation_id']))],
            default => throw new InvalidArgumentException('Unknown scenario '.$job['scenario']),
        };
    } catch (ProblemException $e) {
        return ['ok' => false, 'code' => $e->problem->value, 'status' => $e->status];
    } catch (Throwable $e) {
        return ['ok' => false, 'code' => 'exception', 'error' => get_class($e).': '.$e->getMessage()];
    } finally {
        DB::select('select pg_advisory_unlock_shared(?)', [$job['lock_key']]);
    }
}

while (($line = fgets(STDIN)) !== false && trim($line) !== '') {
    $result = runJob(json_decode($line, true, 8, JSON_THROW_ON_ERROR));
    fwrite(STDOUT, json_encode($result).PHP_EOL);
}
