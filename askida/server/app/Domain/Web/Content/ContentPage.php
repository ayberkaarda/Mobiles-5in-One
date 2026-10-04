<?php

namespace App\Domain\Web\Content;

use App\Support\Web\Format;
use App\Support\Web\PurifiedHtml;
use Carbon\CarbonImmutable;

/**
 * One Markdown document of the public web (a guide or a legal page): its front matter, the
 * purified HTML and the plain Markdown text with the shared facts filled in.
 */
final readonly class ContentPage
{
    public function __construct(
        public string $slug,
        public string $title,
        public string $description,
        public string $answer,
        public CarbonImmutable $published,
        public CarbonImmutable $updated,
        public PurifiedHtml $body,
        public string $markdown,
    ) {}

    /**
     * Words of the rendered body (the measure of the guide length rule).
     */
    public function wordCount(): int
    {
        return Format::words(html_entity_decode(strip_tags($this->body->html), ENT_QUOTES | ENT_HTML5));
    }
}
