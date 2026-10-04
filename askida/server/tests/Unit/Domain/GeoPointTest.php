<?php

use App\Domain\Shops\Models\GeoPoint;

it('formats extended WKT with longitude first', function () {
    expect((new GeoPoint(41.0082, 28.9784))->toEwkt())->toBe('SRID=4326;POINT(28.9784000 41.0082000)');
});

it('parses little and big endian EWKB points with an SRID', function () {
    $little = '0101000020E6100000'.bin2hex(pack('e', 28.9784)).bin2hex(pack('e', 41.0082));
    $big = '0020000001000010E6'.bin2hex(pack('E', 28.9784)).bin2hex(pack('E', 41.0082));

    foreach ([$little, $big] as $hex) {
        $point = GeoPoint::fromEwkbHex($hex);

        expect($point->latitude)->toEqualWithDelta(41.0082, 0.0000001)
            ->and($point->longitude)->toEqualWithDelta(28.9784, 0.0000001);
    }
});

it('parses plain WKB points without an SRID', function () {
    $hex = '0101000000'.bin2hex(pack('e', 29.0)).bin2hex(pack('e', 41.0));

    expect(GeoPoint::fromEwkbHex($hex)->latitude)->toBe(41.0);
});

it('rejects non point geometries and malformed input', function (string $hex) {
    expect(fn () => GeoPoint::fromEwkbHex($hex))->toThrow(InvalidArgumentException::class);
})->with([
    'linestring' => ['0102000020E6100000'.str_repeat('00', 20)],
    'not hex' => ['zz'],
    'too short' => ['0101000020E6100000'],
]);

it('rejects coordinates outside the valid ranges', function (float $lat, float $lng) {
    expect(fn () => new GeoPoint($lat, $lng))->toThrow(InvalidArgumentException::class);
})->with([
    [90.5, 29.0],
    [-91.0, 29.0],
    [41.0, 180.5],
    [41.0, -181.0],
    [NAN, 29.0],
]);
