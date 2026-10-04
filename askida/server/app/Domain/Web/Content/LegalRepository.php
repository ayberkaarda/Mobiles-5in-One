<?php

namespace App\Domain\Web\Content;

/**
 * The two legal sample texts (`resources/content/legal/<slug>.md`).
 */
final class LegalRepository
{
    public const SLUGS = ['gizlilik', 'kvkk-aydinlatma'];

    public function __construct(private readonly MarkdownLoader $loader) {}

    public function find(string $slug): ?ContentPage
    {
        if (! in_array($slug, self::SLUGS, true)) {
            return null;
        }

        return $this->loader->load(resource_path('content/legal/'.$slug.'.md'));
    }

    /**
     * @return list<ContentPage>
     */
    public function all(): array
    {
        return array_map(fn (string $slug): ContentPage => $this->loader->load(resource_path('content/legal/'.$slug.'.md')), self::SLUGS);
    }
}
