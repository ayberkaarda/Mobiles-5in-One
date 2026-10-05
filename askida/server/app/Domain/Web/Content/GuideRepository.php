<?php

namespace App\Domain\Web\Content;

/**
 * The five guides (`resources/content/guides/<slug>.md`), in their fixed display order.
 */
final class GuideRepository
{
    public const SLUGS = [
        'askida-ekmek-gelenegi-nedir',
        'esnaf-icin-askida-sistemi-nasil-isler',
        'bagisiniz-nereye-gidiyor',
        'askidan-almak-ayip-degil',
        'isletmenizi-nasil-dogrulariz',
    ];

    public function __construct(private readonly MarkdownLoader $loader) {}

    public function find(string $slug): ?ContentPage
    {
        if (! in_array($slug, self::SLUGS, true)) {
            return null;
        }

        return $this->loader->load(resource_path('content/guides/'.$slug.'.md'));
    }

    /**
     * @return list<ContentPage>
     */
    public function all(): array
    {
        return array_map(fn (string $slug): ContentPage => $this->loader->load(resource_path('content/guides/'.$slug.'.md')), self::SLUGS);
    }
}
