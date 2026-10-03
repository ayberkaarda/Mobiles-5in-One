<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

it('connects to PostgreSQL with the PostGIS extension enabled', function () {
    expect(DB::connection()->getDriverName())->toBe('pgsql');

    $extension = DB::selectOne("select extname from pg_extension where extname = 'postgis'");
    expect($extension)->not->toBeNull();

    $version = DB::selectOne('select postgis_version() as version');
    expect($version->version)->toBeString()->not->toBeEmpty();
});

it('computes geography distances in PostGIS', function () {
    // Kadikoy pier to Besiktas pier, roughly 5.7 km across the Bosphorus.
    $row = DB::selectOne(
        'select ST_Distance(ST_MakePoint(?, ?)::geography, ST_MakePoint(?, ?)::geography) as meters',
        [29.0230, 40.9923, 29.0072, 41.0422],
    );

    expect((float) $row->meters)->toBeGreaterThan(5000.0)->toBeLessThan(6500.0);
});

it('reaches Redis', function () {
    $pong = Redis::connection()->ping();

    expect($pong === true || $pong === '+PONG' || $pong === 'PONG')->toBeTrue();
});

it('uses Redis as the queue connection', function () {
    expect(config('queue.default'))->toBe('redis');

    $queue = 'smoke-'.Str::lower(Str::random(12));
    $connection = Queue::connection('redis');

    $payload = json_encode([
        'uuid' => (string) Str::uuid(),
        'displayName' => 'smoke',
        'job' => 'smoke',
        'data' => [],
        'attempts' => 0,
    ], JSON_THROW_ON_ERROR);

    $connection->pushRaw($payload, $queue);
    expect($connection->size($queue))->toBe(1);

    $job = $connection->pop($queue);
    expect($job)->not->toBeNull();
    $job?->delete();

    expect($connection->size($queue))->toBe(0);
});
