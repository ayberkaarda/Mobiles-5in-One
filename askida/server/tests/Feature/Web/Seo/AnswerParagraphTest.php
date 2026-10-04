<?php

use App\Domain\Impact\Models\ImpactSnapshot;
use App\Support\Web\Format;
use Database\Seeders\SampleDataSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Web\Seo\Support\PublicSite;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| GEO answer paragraph (spec section 7): every public GET page carries exactly one
| `<p class="answer">` of 40-60 words (whitespace tokens of the rendered text) directly under
| its single H1, so an answer engine can quote the page from its first paragraph. Also on the
| below-threshold impact page and with sample counters.
*/

beforeEach(function (): void {
    WebPage::isolate();
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

it('puts one 40-60 word answer paragraph directly under the H1 of every public page', function (): void {
    $answers = [];

    foreach (PublicSite::seed() as $path => $lang) {
        $html = (string) $this->get($path)->assertOk()->getContent();
        $xpath = PublicSite::dom($html);

        $h1 = $xpath->query('//h1');
        assert($h1 instanceof DOMNodeList);
        expect($h1->length)->toBe(1, "H1 count on {$path}");

        // The element right after the H1 (ignoring whitespace) is the answer paragraph.
        $next = $xpath->query('//h1/following-sibling::*[1]')?->item(0);
        expect($next)->toBeInstanceOf(DOMElement::class);
        assert($next instanceof DOMElement);
        expect($next->nodeName)->toBe('p', "element after the H1 on {$path}")
            ->and($next->getAttribute('class'))->toBe('answer', "element after the H1 on {$path}");

        $text = trim((string) preg_replace('/\s+/u', ' ', $next->textContent));
        $words = Format::words($text);

        expect($words)->toBeGreaterThanOrEqual(WebPage::ANSWER_MIN_WORDS, "{$path}: {$words} words")
            ->toBeLessThanOrEqual(WebPage::ANSWER_MAX_WORDS, "{$path}: {$words} words")
            ->and($xpath->query('//*[contains(concat(" ", normalize-space(@class), " "), " answer ")]')?->length)->toBe(1, "answer paragraphs on {$path}")
            ->and(WebPage::answer($html))->toBe($text);

        expect(isset($answers[$text]))->toBeFalse("{$path} repeats the answer of ".($answers[$text] ?? ''));
        $answers[$text] = $path;
    }
});

it('keeps the answer paragraph on a province impact page below the small-cell threshold', function (): void {
    $row = new ImpactSnapshot;
    $row->forceFill(['il' => 'Muğla', 'ilce' => 'Bodrum', 'day' => now()->toDateString(), 'donated' => 2, 'redeemed' => 1, 'shops' => 1])->save();

    $html = WebPage::assertPublicPage($this->get('/etki/mugla'), 'tr', WebPage::BUDGET_LONG);

    expect($html)->toContain('<meta name="robots" content="noindex,follow">');
});

it('keeps the answer paragraph on the sample home page', function (): void {
    config(['askida.allow_sample_shops' => true]);
    $this->seed(SampleDataSeeder::class);

    WebPage::assertPublicPage($this->get('/'));
    WebPage::assertPublicPage($this->get('/etki'));
});

it('counts words as whitespace tokens', function (): void {
    expect(Format::words('Askıda,  bir   esnafın  tezgâhında'))->toBe(4)
        ->and(Format::words("satır\nsonu\tve sekme"))->toBe(4)
        ->and(Format::words('  '))->toBe(0);
});
