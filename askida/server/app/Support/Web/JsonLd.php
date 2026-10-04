<?php

namespace App\Support\Web;

use JsonException;

/**
 * schema.org builders shared by every public page and the encoder of the
 * `application/ld+json` blocks. Every URL is absolute on the configured origin.
 */
final class JsonLd
{
    public const CONTEXT = 'https://schema.org';

    /**
     * Encoding of the data blocks: `<`, `>` and `&` are escaped as unicode escapes, so no
     * value can close the script element; Turkish letters and slashes stay readable.
     */
    public const FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP;

    /**
     * @return array<string, mixed>
     */
    public static function organization(): array
    {
        return [
            '@context' => self::CONTEXT,
            '@type' => 'Organization',
            '@id' => Origin::url('/').'#organization',
            'name' => Facts::LEGAL_NAME,
            'alternateName' => Facts::BRAND,
            'url' => Origin::url('/'),
            'logo' => Origin::url('/logo/askida-mark.svg'),
            'slogan' => Facts::TAGLINE,
        ];
    }

    /**
     * Reference to the Organization for `author` / `publisher` properties.
     *
     * @return array<string, mixed>
     */
    public static function organizationRef(): array
    {
        return [
            '@type' => 'Organization',
            '@id' => Origin::url('/').'#organization',
            'name' => Facts::LEGAL_NAME,
            'url' => Origin::url('/'),
            'logo' => Origin::url('/logo/askida-mark.svg'),
        ];
    }

    /**
     * BreadcrumbList starting at the home page.
     *
     * @param  list<array{0: string, 1: string}>  $items  [name, path] after the home crumb
     * @return array<string, mixed>
     */
    public static function breadcrumbs(array $items, string $lang = 'tr'): array
    {
        $crumbs = [[Facts::BRAND, $lang === 'en' ? '/en' : '/'], ...$items];
        $elements = [];

        foreach ($crumbs as $index => [$name, $path]) {
            $elements[] = [
                '@type' => 'ListItem',
                'position' => $index + 1,
                'name' => $name,
                'item' => Origin::url($path),
            ];
        }

        return [
            '@context' => self::CONTEXT,
            '@type' => 'BreadcrumbList',
            'itemListElement' => $elements,
        ];
    }

    /**
     * @param  array<string, mixed>  $block
     * @return array<string, mixed>
     */
    public static function withContext(array $block): array
    {
        if (! isset($block['@context'])) {
            $block = ['@context' => self::CONTEXT, ...$block];
        }

        return $block;
    }

    /**
     * JSON for an inline `<script type="application/ld+json">` block (see FLAGS).
     *
     * @param  array<string, mixed>  $block
     *
     * @throws JsonException
     */
    public static function encode(array $block): string
    {
        return json_encode($block, JSON_THROW_ON_ERROR | self::FLAGS);
    }
}
