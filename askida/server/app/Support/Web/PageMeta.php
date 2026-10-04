<?php

namespace App\Support\Web;

use Carbon\CarbonImmutable;
use InvalidArgumentException;

/**
 * Metadata of one public page, consumed by `<x-web.head :meta>` (title, description,
 * canonical, robots, hreflang alternates, Open Graph, JSON-LD).
 *
 * Build it with PageMeta::make(): the canonical URL comes from the path on the configured
 * origin, the alternates follow the hreflang policy (every page `tr-TR` + `x-default`, both
 * the Turkish URL; `en` only when an English translation exists), the BreadcrumbList is
 * built from `breadcrumbs` and the Organization block is added by the head itself.
 *
 * @phpstan-type Alternate array{hreflang: string, href: string}
 */
final readonly class PageMeta
{
    public const TITLE_MAX = 60;

    public const DESCRIPTION_MAX = 155;

    /**
     * @param  list<Alternate>  $alternates
     * @param  list<array<string, mixed>>  $jsonLd  schema.org objects; `@context` is added when missing
     * @param  'tr'|'en'  $lang
     */
    public function __construct(
        public string $title,
        public string $description,
        public string $canonical,
        public array $alternates = [],
        public string $robots = 'index,follow',
        public ?string $ogImage = null,
        public string $ogType = 'website',
        public array $jsonLd = [],
        public ?CarbonImmutable $publishedAt = null,
        public ?CarbonImmutable $modifiedAt = null,
        public string $lang = 'tr',
    ) {
        if (mb_strlen($title) > self::TITLE_MAX || trim($title) === '') {
            throw new InvalidArgumentException('Page title must be 1 to '.self::TITLE_MAX.' characters: '.$title);
        }

        if (mb_strlen($description) > self::DESCRIPTION_MAX || trim($description) === '') {
            throw new InvalidArgumentException('Page description must be 1 to '.self::DESCRIPTION_MAX.' characters.');
        }

        if (! Origin::owns($canonical)) {
            throw new InvalidArgumentException('The canonical URL must be absolute on the configured origin: '.$canonical);
        }

        if ($ogImage !== null && ! Origin::owns($ogImage)) {
            throw new InvalidArgumentException('The Open Graph image must be absolute on the configured origin.');
        }
    }

    /**
     * @param  string  $path  the page's own path, e.g. "/nasil-calisir"
     * @param  list<array{0: string, 1: string}>  $breadcrumbs  [name, path] after the home crumb; empty on "/"
     * @param  list<array<string, mixed>>  $jsonLd  page-specific blocks (Organization and BreadcrumbList are automatic)
     * @param  array{tr: string, en: string}|null  $translations  paths of the Turkish and English versions, only for pages that have both
     * @param  'tr'|'en'  $lang
     */
    public static function make(
        string $path,
        string $title,
        string $description,
        array $breadcrumbs = [],
        array $jsonLd = [],
        ?array $translations = null,
        string $lang = 'tr',
        string $robots = 'index,follow',
        ?string $ogImage = null,
        string $ogType = 'website',
        ?CarbonImmutable $publishedAt = null,
        ?CarbonImmutable $modifiedAt = null,
    ): self {
        $canonical = Origin::url($path);

        if ($translations === null) {
            $alternates = [
                ['hreflang' => 'tr-TR', 'href' => $canonical],
                ['hreflang' => 'x-default', 'href' => $canonical],
            ];
        } else {
            $alternates = [
                ['hreflang' => 'tr-TR', 'href' => Origin::url($translations['tr'])],
                ['hreflang' => 'en', 'href' => Origin::url($translations['en'])],
                ['hreflang' => 'x-default', 'href' => Origin::url($translations['tr'])],
            ];
        }

        if ($breadcrumbs !== []) {
            $jsonLd[] = JsonLd::breadcrumbs($breadcrumbs, $lang);
        }

        return new self(
            title: $title,
            description: $description,
            canonical: $canonical,
            alternates: $alternates,
            robots: $robots,
            ogImage: $ogImage,
            ogType: $ogType,
            jsonLd: $jsonLd,
            publishedAt: $publishedAt,
            modifiedAt: $modifiedAt,
            lang: $lang,
        );
    }

    /**
     * Open Graph image: the page's own or the site default.
     */
    public function ogImageUrl(): string
    {
        return $this->ogImage ?? Origin::url('/og/default.png');
    }

    public function ogLocale(): string
    {
        return $this->lang === 'en' ? 'en_US' : 'tr_TR';
    }

    /**
     * Every JSON-LD block of the page, Organization first, each with its `@context`.
     *
     * @return list<array<string, mixed>>
     */
    public function jsonLdBlocks(): array
    {
        $blocks = [JsonLd::organization()];

        foreach ($this->jsonLd as $block) {
            $blocks[] = $block;
        }

        return array_map(JsonLd::withContext(...), $blocks);
    }

    public function isIndexable(): bool
    {
        return ! str_contains($this->robots, 'noindex');
    }
}
