<?php

use App\Domain\Shops\Models\Shop;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| Stored XSS: shop, item, province and district names are merchant input. Each payload is
| written into every name field of a listed shop, and every directory surface (shop page,
| district page, province page, JSON-LD, sitemap, share image) must render it as inert
| text. Assertions are made on the parsed DOM, not on substrings, so escaped text such as
| `onerror=` inside a text node is not mistaken for an attribute.
*/

beforeEach(function (): void {
    WebPage::isolate();
    Storage::fake('public');
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

dataset('xss payloads', [
    'script element' => ['<script>alert(1)</script>'],
    'attribute breakout' => ['"><img src=x onerror=alert(1)>'],
    'json-ld breakout' => ['</script><script>alert(1)</script>'],
    'comment and entity' => ['<!-- x --><svg onload=alert(1)>&lt;'],
]);

/**
 * The listed shop whose every name field carries the payload.
 */
function xssShop(string $payload): Shop
{
    $shop = DirectoryWorld::listed([
        'slug' => 'xss-dukkani',
        'name' => mb_substr('Fırın '.$payload, 0, 120),
        'address' => mb_substr('Sokak '.$payload, 0, 255),
        'il' => mb_substr('İl '.$payload, 0, 64),
        'ilce' => mb_substr('İlçe '.$payload, 0, 64),
        'opening_hours' => DirectoryWorld::HOURS,
    ]);

    DirectoryWorld::item($shop, 2, ['name' => mb_substr('Ürün '.$payload, 0, 120)]);

    return $shop;
}

/**
 * The page HTML after the checks of the public page contract that do not scan raw markup
 * with a regular expression: WebPage::assertPublicPage() looks for event handler
 * attributes with a regex over the raw HTML, which also matches the escaped payload
 * inside an attribute value (`content="... &gt;&lt;img onerror=..."`), so the attribute
 * checks are made on the DOM below instead.
 */
function xssPage(TestResponse $response): string
{
    $response->assertOk();
    $html = (string) $response->getContent();

    WebPage::assertNoExternalHosts($html);
    WebPage::assertSingleH1($html);
    WebPage::assertAnswerParagraph($html);
    WebPage::assertBudget($html, WebPage::BUDGET);

    return $html;
}

/**
 * DOM checks: the only scripts are JSON-LD data blocks, no element carries an event
 * handler attribute, and the payload's own elements never become elements.
 */
function assertInertDom(string $html, int $expectedScripts): void
{
    $dom = new DOMDocument;
    $previous = libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8"?>'.$html, LIBXML_NONET);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    $scripts = $dom->getElementsByTagName('script');
    expect($scripts->length)->toBe($expectedScripts);

    foreach ($scripts as $script) {
        expect($script->getAttribute('type'))->toBe('application/ld+json');
        json_decode($script->textContent, flags: JSON_THROW_ON_ERROR);
    }

    expect($dom->getElementsByTagName('img')->length)->toBe(0);

    foreach ((new DOMXPath($dom))->query('//*') ?: [] as $element) {
        assert($element instanceof DOMElement);

        foreach ($element->attributes ?? [] as $attribute) {
            expect(str_starts_with(strtolower($attribute->nodeName), 'on'))->toBeFalse("Event handler attribute {$attribute->nodeName} on <{$element->nodeName}>");
        }

        if ($element->nodeName === 'svg') {
            // Only the inline pictograms of the components, never markup from a name.
            expect($element->getAttribute('aria-hidden'))->toBe('true');
        }
    }
}

it('renders a payload in shop names as text on the shop page and in its JSON-LD', function (string $payload): void {
    $shop = xssShop($payload);

    $html = xssPage($this->get('/dukkan/xss-dukkani'));

    assertInertDom($html, 3);

    $business = WebPage::jsonLd($html)[1];

    expect($business['name'])->toBe($shop->name)
        ->and($business['address']['streetAddress'])->toBe($shop->address)
        ->and($business['address']['addressRegion'])->toBe($shop->il)
        ->and($html)->toContain(e($shop->name));
})->with('xss payloads');

it('renders a payload in names as text on the district and province pages', function (string $payload): void {
    $shop = xssShop($payload);

    $district = xssPage($this->get('/dukkanlar/'.$shop->il_slug.'/'.$shop->ilce_slug));
    $province = xssPage($this->get('/dukkanlar/'.$shop->il_slug));

    assertInertDom($district, 2);
    assertInertDom($province, 2);

    expect($district)->toContain(e($shop->name))->toContain(e($shop->ilce))
        ->and($province)->toContain(e($shop->ilce));

    $crumbs = WebPage::jsonLd($district)[1]['itemListElement'];
    expect(array_column($crumbs, 'name'))->toBe(['Askıda', $shop->il, $shop->ilce]);
})->with('xss payloads');

it('keeps the sitemap well-formed with slugs only', function (string $payload): void {
    $shop = xssShop($payload);

    $xml = (string) $this->get('/sitemap.xml')->assertOk()->getContent();
    $document = simplexml_load_string($xml);

    expect($document)->not->toBeFalse()
        ->and($xml)->not->toContain('<script')
        ->and($xml)->not->toContain('alert(1)')
        ->and($xml)->toContain('<loc>https://askida.app/dukkan/xss-dukkani</loc>')
        ->and($xml)->toContain('<loc>https://askida.app/dukkanlar/'.$shop->il_slug.'/'.$shop->ilce_slug.'</loc>');

    expect($shop->il_slug)->toMatch('/^[a-z0-9]+(?:-[a-z0-9]+)*$/')
        ->and($shop->ilce_slug)->toMatch('/^[a-z0-9]+(?:-[a-z0-9]+)*$/');
})->with('xss payloads');

it('draws a payload in the name as pixels in the share image', function (string $payload): void {
    xssShop($payload);

    $response = $this->get('/og/dukkan/xss-dukkani.png')->assertOk()->assertHeader('Content-Type', 'image/png');
    $size = getimagesizefromstring((string) $response->getContent());

    expect($size)->not->toBeFalse()
        ->and([$size[0], $size[1], $size['mime']])->toBe([1200, 630, 'image/png']);
})->with('xss payloads');
