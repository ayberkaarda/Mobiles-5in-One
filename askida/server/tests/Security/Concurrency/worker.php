<?php

/*
| A participant of the concurrency scenarios, run as its own OS process by
| ConcurrencyHarness. It boots the application once against the test database, says
| "ready", then serves jobs: one JSON job per stdin line, one JSON result per stdout
| line. For each job it waits at the start barrier (a shared advisory lock that the
| harness holds exclusively until every participant waits on it), runs one engine
| operation or one request through the HTTP kernel (scenario `http`) and reports the
| outcome. An empty line or end of input stops it.
*/

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Services\HookIssuer;
use App\Domain\Hooks\Services\HookRedemptionService;
use App\Domain\Hooks\Services\HookReleaseService;
use App\Domain\Hooks\Services\HookReservationService;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

require __DIR__.'/../../../vendor/autoload.php';

$app = require __DIR__.'/../../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
DB::select('select 1');

fwrite(STDOUT, "ready\n");

/**
 * Settles one provider token through the payment settlement service. The fake gateway of
 * this process answers what the job says (its state is per process), so every
 * participant sees the same provider answer.
 *
 * @param  array<string, string>  $args
 */
function settleScenario(array $args): string
{
    $gateway = app(FakeGateway::class);
    $gateway->scriptPayment($args['token'], ProviderPaymentStatus::from($args['status']), (int) $args['paid'], $args['currency'], $args['conversation']);
    app()->instance(PaymentGateway::class, $gateway);

    return app(SettlesPayments::class)->settle($args['token'])->value;
}

/**
 * Sends one JSON request through the HTTP kernel of this process: the whole stack runs
 * (routing, Sanctum, form requests, limiters, controllers), not only the engine call.
 * Auth guards are reset first so no user of an earlier job is remembered.
 *
 * Args: method, uri, token (optional bearer), body (optional raw JSON), ip (optional).
 *
 * @param  array<string, string>  $args
 * @return array<string, mixed> ok (status below 400), status, problem code (or null)
 */
function httpScenario(array $args): array
{
    app('auth')->forgetGuards();

    $server = [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_ACCEPT' => 'application/json',
        'REMOTE_ADDR' => $args['ip'] ?? '127.0.0.1',
    ];

    if (($args['token'] ?? '') !== '') {
        $server['HTTP_AUTHORIZATION'] = 'Bearer '.$args['token'];
    }

    $request = Request::create($args['uri'], $args['method'], [], [], [], $server, $args['body'] ?? '');
    $kernel = app(HttpKernel::class);
    $response = $kernel->handle($request);
    $kernel->terminate($request, $response);

    $decoded = json_decode((string) $response->getContent(), true);

    return [
        'ok' => $response->getStatusCode() < 400,
        'status' => $response->getStatusCode(),
        'code' => is_array($decoded) && is_string($decoded['code'] ?? null) ? $decoded['code'] : null,
    ];
}

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
        if ($job['scenario'] === 'http') {
            return httpScenario($args);
        }

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
            'settle' => ['outcome' => settleScenario($args)],
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
