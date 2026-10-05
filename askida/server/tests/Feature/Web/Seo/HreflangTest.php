<?php

use App\Support\Web\Origin;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Seo\Support\PublicSite;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| hreflang and canonical policy (ADR-0044): every public page names itself as canonical on
| the configured origin and emits `tr-TR` and `x-default` alternates (the Turkish URL); `en`
| exists only on the two pages with an English version (/en, /en/how-it-works) and their
| Turkish counterparts, and those links are reciprocal. Origin from WEB_ORIGIN, never from
| the request host.
*/

beforeEach(function (): void {
    WebPage::isolate();
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

/**
 * @return array{canonical: list<string>, alternates: array<string, string>, lang: string}
 */
function hreflangLinks(string $html): array
{
    $xpath = PublicSite::dom($html);
    $alternates = [];

    foreach ($xpath->query('//head/link[@rel="alternate"][@hreflang]') ?: [] as $link) {
        assert($link instanceof DOMElement);
        $hreflang = $link->getAttribute('hreflang');

        expect($alternates)->not->toHaveKey($hreflang);
        $alternates[$hreflang] = $link->getAttribute('href');
    }

    return [
        'canonical' => PublicSite::attributes($xpath, '//head/link[@rel="canonical"]', 'href'),
        'alternates' => $alternates,
        'lang' => PublicSite::attributes($xpath, '/html', 'lang')[0] ?? '',
    ];
}

it('names every page as its own canonical with tr-TR and x-default alternates', function (): void {
    foreach (PublicSite::seed() as $path => $lang) {
        $links = hreflangLinks(WebPage::assertPublicPage($this->get($path), $lang, WebPage::BUDGET_LONG));
        $self = Origin::url($path);

        expect($links['canonical'])->toBe([$self], "canonical of {$path}")
            ->and($links['lang'])->toBe($lang, "lang of {$path}");

        if (! array_key_exists($path, PublicSite::TRANSLATED)) {
            expect($links['alternates'])->toBe(['tr-TR' => $self, 'x-default' => $self], "alternates of {$path}");

            continue;
        }

        $turkish = $lang === 'tr' ? $path : PublicSite::TRANSLATED[$path];
        $english = $lang === 'en' ? $path : PublicSite::TRANSLATED[$path];

        expect($links['alternates'])->toBe([
            'tr-TR' => Origin::url($turkish),
            'en' => Origin::url($english),
            'x-default' => Origin::url($turkish),
        ], "alternates of {$path}");
    }
});

it('links the translated pages reciprocally', function (): void {
    foreach (PublicSite::TRANSLATED as $path => $counterpart) {
        $own = hreflangLinks((string) $this->get($path)->assertOk()->getContent());
        $other = hreflangLinks((string) $this->get($counterpart)->assertOk()->getContent());

        // Both sides list the same set, each includes itself, and each points at the other.
        expect($own['alternates'])->toBe($other['alternates'])
            ->and(array_values($own['alternates']))->toContain(Origin::url($path))
            ->and(array_values($own['alternates']))->toContain(Origin::url($counterpart));
    }
});

it('emits no English alternate on pages without an English version', function (): void {
    foreach (array_diff_key(PublicSite::seed(), PublicSite::TRANSLATED) as $path => $lang) {
        $html = (string) $this->get($path)->assertOk()->getContent();

        expect(str_contains($html, 'hreflang="en"'))->toBeFalse("English alternate on {$path}")
            ->and(str_contains($html, '<html lang="tr">'))->toBeTrue("lang of {$path}");
    }
});

it('builds canonical and alternate URLs from the configured origin, never the request host', function (): void {
    config(['web.origin' => 'https://ornek.askida.app']);

    foreach (['/', '/en/how-it-works', '/sss'] as $path) {
        $html = (string) $this->get('http://evil.example'.$path)->assertOk()->getContent();
        $links = hreflangLinks($html);

        expect($html)->not->toContain('evil.example')
            ->and($links['canonical'])->toBe([Origin::url($path)]);

        foreach ($links['alternates'] as $href) {
            expect($href)->toStartWith('https://ornek.askida.app/');
        }
    }
});

it('canonicalises a paged district list to its own page', function (): void {
    PublicSite::seed();

    $links = hreflangLinks((string) $this->get('/dukkanlar/istanbul/kadikoy?sayfa=1')->assertOk()->getContent());

    expect($links['canonical'][0])->toStartWith('https://askida.app/dukkanlar/istanbul/kadikoy');
});
