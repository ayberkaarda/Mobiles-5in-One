<?php

namespace App\Domain\Shops\Models;

use InvalidArgumentException;

/**
 * A WGS 84 coordinate (SRID 4326) as stored in a PostGIS geography(Point) column.
 */
final readonly class GeoPoint
{
    public function __construct(
        public float $latitude,
        public float $longitude,
    ) {
        if (! is_finite($latitude) || $latitude < -90.0 || $latitude > 90.0) {
            throw new InvalidArgumentException('Latitude must be between -90 and 90.');
        }

        if (! is_finite($longitude) || $longitude < -180.0 || $longitude > 180.0) {
            throw new InvalidArgumentException('Longitude must be between -180 and 180.');
        }
    }

    /**
     * Extended WKT, sent to PostgreSQL as a bound parameter and parsed by the geography type.
     */
    public function toEwkt(): string
    {
        return sprintf('SRID=4326;POINT(%.7F %.7F)', $this->longitude, $this->latitude);
    }

    /**
     * Parses the hex EWKB text PostgreSQL returns for a geography(Point) column.
     */
    public static function fromEwkbHex(string $hex): self
    {
        if (strlen($hex) % 2 !== 0 || ! ctype_xdigit($hex)) {
            throw new InvalidArgumentException('Value is not a hex encoded point.');
        }

        $binary = hex2bin($hex);

        if ($binary === false || strlen($binary) < 21) {
            throw new InvalidArgumentException('Value is not a hex encoded point.');
        }

        $littleEndian = ord($binary[0]) === 1;
        $header = unpack($littleEndian ? 'Vtype' : 'Ntype', substr($binary, 1, 4));

        if ($header === false) {
            throw new InvalidArgumentException('Value is not a hex encoded point.');
        }

        $type = (int) $header['type'];
        $hasSrid = ($type & 0x20000000) !== 0;

        if (($type & 0x0FFFFFFF) !== 1) {
            throw new InvalidArgumentException('Geometry is not a point.');
        }

        $offset = $hasSrid ? 9 : 5;
        $coordinates = substr($binary, $offset, 16);

        if (strlen($coordinates) !== 16) {
            throw new InvalidArgumentException('Value is not a hex encoded point.');
        }

        $values = unpack($littleEndian ? 'ex/ey' : 'Ex/Ey', $coordinates);

        if ($values === false) {
            throw new InvalidArgumentException('Value is not a hex encoded point.');
        }

        return new self((float) $values['y'], (float) $values['x']);
    }
}
