<?php

namespace Tests\Security\Concurrency;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Assert;
use RuntimeException;

/**
 * Runs engine operations in parallel OS processes against the real PostgreSQL test
 * database (security items 4 and 23).
 *
 * Design:
 * - a pool of `php tests/Security/Concurrency/worker.php` processes (proc_open), each
 *   with its own database session, so row locks are real. The pool boots once per test
 *   file and serves every scenario of it (booting the framework is the slow part);
 * - start barrier per scenario: the harness takes an exclusive PostgreSQL advisory
 *   lock, sends one job to each participant, waits until `pg_locks` shows every
 *   participant blocked on a shared request for that lock, then releases it, so all
 *   participants start in the same instant. No sleep decides an outcome;
 * - fixtures are committed (the tests do not wrap themselves in a transaction, or the
 *   workers could not see them) and removed by the test afterwards with scoped deletes;
 * - each job answers with one JSON line: {ok: true, ...} or {ok: false, code: <problem>}.
 */
final class ConcurrencyHarness
{
    private const BARRIER_TIMEOUT_SECONDS = 30;

    /** @var list<array{process: resource, stdin: resource, stdout: resource, log: string}> */
    private static array $pool = [];

    /**
     * Makes sure the schema exists when this file runs before any refreshing test.
     */
    public static function ensureSchema(): void
    {
        Artisan::call('migrate', ['--force' => true]);
    }

    /**
     * @param  list<array{scenario: string, args?: array<string, string>, now?: string|null}>  $jobs
     * @return list<array<string, mixed>> one decoded result per job, in job order
     */
    public static function run(array $jobs, int $poolSize): array
    {
        self::boot($poolSize);
        Assert::assertLessThanOrEqual(count(self::$pool), count($jobs), 'More jobs than workers.');

        $lockKey = random_int(1_000_000, 2_000_000_000);
        $pepper = (string) config('askida.hook_code_pepper');
        DB::select('select pg_advisory_lock(?)', [$lockKey]);

        try {
            foreach (array_values($jobs) as $i => $job) {
                fwrite(self::$pool[$i]['stdin'], json_encode([
                    'scenario' => $job['scenario'],
                    'args' => $job['args'] ?? [],
                    'now' => $job['now'] ?? null,
                    'lock_key' => $lockKey,
                    'pepper' => $pepper,
                ], JSON_THROW_ON_ERROR).PHP_EOL);
            }

            self::awaitBarrier($lockKey, count($jobs));
        } finally {
            DB::select('select pg_advisory_unlock(?)', [$lockKey]);
        }

        $results = [];

        foreach (array_keys(array_values($jobs)) as $i) {
            $results[] = self::readResult(self::$pool[$i]);
        }

        return $results;
    }

    /**
     * Stops the pool (end of the test file).
     */
    public static function shutdown(): void
    {
        foreach (self::$pool as $worker) {
            @fwrite($worker['stdin'], PHP_EOL);
            @fclose($worker['stdin']);
            @fclose($worker['stdout']);
            proc_close($worker['process']);
            @unlink($worker['log']);
        }

        self::$pool = [];
    }

    /**
     * Removes the committed fixtures of a scenario: everything hanging off the given
     * shops (units, donations, items, members), the users involved and the given anon
     * devices with their tokens and counters. Every delete is scoped by id.
     *
     * @param  list<string>  $shopIds
     * @param  list<string>  $anonIds
     */
    public static function cleanup(array $shopIds, array $anonIds): void
    {
        $userIds = DB::table('shops')->whereIn('id', $shopIds)->whereNotNull('owner_id')->pluck('owner_id')
            ->merge(DB::table('shop_members')->whereIn('shop_id', $shopIds)->pluck('user_id'))
            ->merge(DB::table('donations')->whereIn('shop_id', $shopIds)->whereNotNull('donor_id')->pluck('donor_id'))
            ->unique()->values()->all();
        $hookIds = DB::table('hooks')->whereIn('shop_id', $shopIds)->pluck('id')->all();
        $deviceIds = DB::table('anon_devices')->whereIn('anon_id', $anonIds)->pluck('id')->all();

        DB::table('activity_log')->whereIn('subject_id', $hookIds)->delete();
        DB::table('hooks')->whereIn('shop_id', $shopIds)->delete();
        DB::table('donations')->whereIn('shop_id', $shopIds)->delete();
        DB::table('items')->whereIn('shop_id', $shopIds)->delete();
        DB::table('shop_members')->whereIn('shop_id', $shopIds)->delete();
        DB::table('shops')->whereIn('id', $shopIds)->delete();
        DB::table('personal_access_tokens')->whereIn('tokenable_id', array_merge($deviceIds, $userIds))->delete();
        DB::table('anon_daily_counters')->whereIn('anon_id', $anonIds)->delete();
        DB::table('anon_devices')->whereIn('anon_id', $anonIds)->delete();
        DB::table('users')->whereIn('id', $userIds)->delete();
    }

    private static function boot(int $size): void
    {
        if (count(self::$pool) >= $size) {
            return;
        }

        $environment = self::environment();

        while (count(self::$pool) < $size) {
            $log = tempnam(sys_get_temp_dir(), 'askida-race-');
            $process = proc_open(
                [PHP_BINARY, __DIR__.'/worker.php'],
                [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', (string) $log, 'a']],
                $pipes,
                base_path(),
                $environment,
            );

            if (! is_resource($process)) {
                throw new RuntimeException('Could not start a worker process.');
            }

            self::$pool[] = ['process' => $process, 'stdin' => $pipes[0], 'stdout' => $pipes[1], 'log' => (string) $log];
        }

        foreach (self::$pool as $worker) {
            $line = fgets($worker['stdout']);
            Assert::assertSame("ready\n", $line, 'Worker did not start: '.@file_get_contents($worker['log']));
        }
    }

    /**
     * Same database as the test, no queue or log side effects.
     *
     * @return array<string, string>
     */
    private static function environment(): array
    {
        $connection = (array) config('database.connections.pgsql');
        $inherited = array_filter(getenv(), is_string(...));

        return array_merge($inherited, [
            'APP_ENV' => 'testing',
            'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => (string) ($connection['host'] ?? 'postgres'),
            'DB_PORT' => (string) ($connection['port'] ?? '5432'),
            'DB_DATABASE' => (string) ($connection['database'] ?? 'askida_testing'),
            'DB_USERNAME' => (string) ($connection['username'] ?? 'askida'),
            'DB_PASSWORD' => (string) ($connection['password'] ?? ''),
            'CACHE_STORE' => 'array',
            'QUEUE_CONNECTION' => 'null',
            'LOG_CHANNEL' => 'null',
            'BROADCAST_CONNECTION' => 'null',
        ]);
    }

    private static function awaitBarrier(int $lockKey, int $participants): void
    {
        $deadline = microtime(true) + self::BARRIER_TIMEOUT_SECONDS;

        do {
            $waiting = (int) DB::scalar(
                "select count(*) from pg_locks where locktype = 'advisory' and classid = 0 and objid = ? and objsubid = 1 and not granted",
                [$lockKey],
            );

            if ($waiting >= $participants) {
                return;
            }

            // Polling for readiness only; the outcome never depends on this pause.
            usleep(5_000);
        } while (microtime(true) < $deadline);

        Assert::fail("Only {$waiting} of {$participants} workers reached the start barrier.");
    }

    /**
     * @param  array{process: resource, stdin: resource, stdout: resource, log: string}  $worker
     * @return array<string, mixed>
     */
    private static function readResult(array $worker): array
    {
        $line = fgets($worker['stdout']);
        $result = is_string($line) ? json_decode($line, true) : null;

        Assert::assertIsArray($result, 'Worker gave no result: '.@file_get_contents($worker['log']));
        Assert::assertNotSame('exception', $result['code'] ?? null, 'Worker failed: '.($result['error'] ?? ''));

        return $result;
    }
}
