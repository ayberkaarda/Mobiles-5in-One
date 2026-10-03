<?php

use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use Database\Seeders\SampleDataSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

it('round-trips a shop location through the geography column', function () {
    $shop = Shop::factory()->at(41.0082, 28.9784)->create();

    $fresh = Shop::query()->findOrFail($shop->id);

    expect($fresh->location)->toBeInstanceOf(GeoPoint::class)
        ->and($fresh->location->latitude)->toEqualWithDelta(41.0082, 0.0000001)
        ->and($fresh->location->longitude)->toEqualWithDelta(28.9784, 0.0000001);

    $stored = DB::selectOne('select ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, ST_SRID(location::geometry) as srid from shops where id = ?', [$shop->id]);

    expect((float) $stored->lat)->toEqualWithDelta(41.0082, 0.0000001)
        ->and((float) $stored->lng)->toEqualWithDelta(28.9784, 0.0000001)
        ->and((int) $stored->srid)->toBe(4326);
});

it('updates a location through the cast', function () {
    $shop = Shop::factory()->create();

    $shop->location = new GeoPoint(40.9903, 29.0290);
    $shop->save();

    expect(Shop::query()->findOrFail($shop->id)->location->latitude)->toEqualWithDelta(40.9903, 0.0000001);
});

it('finds the sample shops within a radius using a bound ST_DWithin query', function (float $lat, float $lng, int $meters, array $slugs) {
    $this->seed(SampleDataSeeder::class);

    $found = Shop::query()
        ->withinMeters(new GeoPoint($lat, $lng), $meters)
        ->orderBy('slug')
        ->pluck('slug')
        ->all();

    sort($slugs);

    expect($found)->toBe($slugs);
})->with([
    'Moda, 3 km' => [40.9877, 29.0262, 3_000, ['ornek-moda-firini']],
    'Bosphorus between Beşiktaş and Kuzguncuk, 3 km' => [41.0400, 29.0200, 3_000, ['ornek-carsi-lokantasi', 'ornek-kuzguncuk-kirtasiyesi']],
    'Bosphorus between Beşiktaş and Kuzguncuk, 5 km' => [41.0400, 29.0200, 5_000, ['ornek-carsi-lokantasi', 'ornek-kuzguncuk-kirtasiyesi', 'ornek-mecidiyekoy-corbacisi']],
    'open sea south of the city, 5 km' => [40.8500, 28.9000, 5_000, []],
]);

it('orders shops by distance from a point', function () {
    $this->seed(SampleDataSeeder::class);

    $ordered = Shop::query()
        ->orderByDistance(new GeoPoint(41.0400, 29.0200))
        ->get();

    $distances = $ordered->map(fn (Shop $shop) => (float) $shop->getAttribute('distance_m'))->all();
    $sorted = $distances;
    sort($sorted);

    expect($ordered)->toHaveCount(6)
        ->and($distances)->toBe($sorted)
        ->and($distances[0])->toBeGreaterThan(0.0)->toBeLessThan(3_000.0)
        ->and($ordered->take(2)->pluck('slug')->sort()->values()->all())->toBe(['ornek-carsi-lokantasi', 'ornek-kuzguncuk-kirtasiyesi']);
});

it('returns no shop for a zero radius', function () {
    $this->seed(SampleDataSeeder::class);

    $count = Shop::query()->withinMeters(new GeoPoint(41.0400, 29.0200), 0)->count();

    expect($count)->toBe(0)
        ->and(Shop::query()->count())->toBe(6);
});
