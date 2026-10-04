<?php

namespace App\Domain\Web\Directory;

use App\Domain\Shops\Models\Shop;
use App\Support\Web\JsonLd;
use App\Support\Web\Origin;

/**
 * schema.org LocalBusiness block of a shop page: the subtype by shop type, the postal
 * address, the coordinates, the opening hours and the telephone. Only the public facts a
 * shop page shows; empty values are left out rather than written as empty strings.
 */
final class ShopJsonLd
{
    /**
     * @return array<string, mixed>
     */
    public static function for(Shop $shop): array
    {
        $url = Origin::url('/dukkan/'.$shop->slug);

        $block = [
            '@context' => JsonLd::CONTEXT,
            '@type' => ShopKind::schemaType($shop->type),
            '@id' => $url.'#shop',
            'name' => $shop->name,
            'url' => $url,
            'image' => Origin::url('/og/dukkan/'.$shop->slug.'.png'),
            'address' => array_filter([
                '@type' => 'PostalAddress',
                'streetAddress' => trim($shop->address),
                'addressLocality' => trim($shop->ilce),
                'addressRegion' => trim($shop->il),
                'addressCountry' => 'TR',
            ], static fn (string $value): bool => $value !== ''),
            'geo' => [
                '@type' => 'GeoCoordinates',
                'latitude' => round($shop->location->latitude, 6),
                'longitude' => round($shop->location->longitude, 6),
            ],
        ];

        $hours = OpeningHours::toSchemaOrg($shop->opening_hours);

        if ($hours !== []) {
            $block['openingHoursSpecification'] = $hours;
        }

        $phone = self::telephone($shop->phone);

        if ($phone !== null) {
            $block['telephone'] = $phone;
        }

        return $block;
    }

    /**
     * E.164 form of a stored Turkish number ("+90 212 000 00 00" -> "+902120000000"), or
     * null when the stored value is not a phone number.
     */
    public static function telephone(string $phone): ?string
    {
        $digits = (string) preg_replace('/[^\d+]/', '', $phone);

        return preg_match('/^\+90\d{10}$/', $digits) === 1 ? $digits : null;
    }
}
