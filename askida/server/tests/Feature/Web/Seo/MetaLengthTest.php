<?php

use App\Support\Web\PageMeta;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Seo\Support\PublicSite;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| Titles and descriptions of every public page (spec section 7, technical SEO): the title is
| at most 60 characters, the description at most 155, both are unique across the site and
| the Open Graph title and description repeat them.
*/

beforeEach(function (): void {
    WebPage::isolate();
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

/**
 * @return array{title: string, description: string, ogTitle: string, ogDescription: string}
 */
function pageMetaTags(string $html): array
{
    $xpath = PublicSite::dom($html);

    $titles = $xpath->query('//head/title');
    assert($titles instanceof DOMNodeList);
    expect($titles->length)->toBe(1);

    $content = static function (string $query) use ($xpath): string {
        $values = PublicSite::attributes($xpath, $query, 'content');
        expect($values)->toHaveCount(1, $query);

        return $values[0];
    };

    return [
        'title' => trim((string) $titles->item(0)?->textContent),
        'description' => $content('//head/meta[@name="description"]'),
        'ogTitle' => $content('//head/meta[@property="og:title"]'),
        'ogDescription' => $content('//head/meta[@property="og:description"]'),
    ];
}

it('keeps every title within 60 and every description within 155 characters, unique per page', function (): void {
    $titles = [];
    $descriptions = [];

    foreach (PublicSite::seed() as $path => $lang) {
        $meta = pageMetaTags(WebPage::assertPublicPage($this->get($path), $lang, WebPage::BUDGET_LONG));

        expect(mb_strlen($meta['title']))->toBeGreaterThan(0)->toBeLessThanOrEqual(PageMeta::TITLE_MAX, "Title of {$path}: {$meta['title']}")
            ->and(mb_strlen($meta['description']))->toBeGreaterThan(0)->toBeLessThanOrEqual(PageMeta::DESCRIPTION_MAX, "Description of {$path}")
            ->and($meta['ogTitle'])->toBe($meta['title'], "og:title of {$path}")
            ->and($meta['ogDescription'])->toBe($meta['description'], "og:description of {$path}");

        expect(isset($titles[$meta['title']]))->toBeFalse("Title of {$path} repeats the one of ".($titles[$meta['title']] ?? ''))
            ->and(isset($descriptions[$meta['description']]))->toBeFalse("Description of {$path} repeats the one of ".($descriptions[$meta['description']] ?? ''));

        $titles[$meta['title']] = $path;
        $descriptions[$meta['description']] = $path;
    }

    expect($titles)->toHaveCount(count(PublicSite::paths()));
});

it('refuses page metadata over the limits', function (): void {
    expect(fn () => PageMeta::make(path: '/x', title: str_repeat('a', PageMeta::TITLE_MAX + 1), description: 'Kısa açıklama.'))
        ->toThrow(InvalidArgumentException::class);

    expect(fn () => PageMeta::make(path: '/x', title: 'Kısa başlık', description: str_repeat('a', PageMeta::DESCRIPTION_MAX + 1)))
        ->toThrow(InvalidArgumentException::class);

    // Characters, not bytes: 60 Turkish letters are 120 bytes and still fit.
    expect(mb_strlen(PageMeta::make(path: '/x', title: str_repeat('ı', PageMeta::TITLE_MAX), description: str_repeat('ş', PageMeta::DESCRIPTION_MAX))->title))
        ->toBe(PageMeta::TITLE_MAX);
});
