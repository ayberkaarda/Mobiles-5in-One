<?php

use App\Domain\Shops\Models\Shop;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

it('runs the database session in the application time zone', function (): void {
    $row = DB::selectOne('select current_setting(?) as tz', ['TimeZone']);

    expect($row->tz)->toBe(config('app.timezone'));
});

it('agrees with the application clock on the current instant', function (): void {
    $row = DB::selectOne('select extract(epoch from now()) as epoch');

    expect(abs((float) $row->epoch - Carbon::now()->getPreciseTimestamp(6) / 1_000_000))->toBeLessThan(1.0);
});

it('stores a naive Eloquent timestamp as the same instant', function (): void {
    $before = Carbon::now()->startOfSecond();
    $shop = Shop::factory()->create();

    $row = DB::selectOne('select extract(epoch from created_at) as epoch from shops where id = ?', [$shop->getKey()]);

    expect((int) $row->epoch)->toBeGreaterThanOrEqual($before->getTimestamp())
        ->and((int) $row->epoch)->toBeLessThanOrEqual(Carbon::now()->getTimestamp() + 1)
        ->and($shop->fresh()?->created_at?->getTimestamp())->toBe((int) $row->epoch);
});

it('round-trips a timestamp written through the query builder without an offset', function (): void {
    $instant = Carbon::now()->subDays(3)->startOfSecond();
    $shop = Shop::factory()->create();

    DB::table('shops')->where('id', $shop->getKey())->update(['updated_at' => $instant->format('Y-m-d H:i:s')]);

    $row = DB::selectOne('select extract(epoch from updated_at) as epoch from shops where id = ?', [$shop->getKey()]);

    expect((int) $row->epoch)->toBe($instant->getTimestamp())
        ->and($shop->fresh()?->updated_at?->equalTo($instant))->toBeTrue();
});
