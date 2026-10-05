<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Services\PayPageStore;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\Datasets\XssPayloads;
use Tests\Feature\Web\Support\WebPage;
use Tests\Security\Xss\XssSurface;
use Tests\Security\Xss\XssWorld;

uses(RefreshDatabase::class);

/*
| Stored-XSS sweep, public web surfaces (security checklist item 16). Every payload is
| written through the real merchant API (POST shops, POST items) and then read on the shop
| page, the district and province pages, the sitemap, the share image route and
| /llms-full.txt. HTML is parsed with DOMDocument: escaped text containing `onerror=` is
| harmless, an `onerror` attribute is not.
*/

beforeEach(function (): void {
    WebPage::isolate();
    Storage::fake('public');
    config(['web.origin' => 'https://askida.app', 'askida.allow_sample_shops' => false]);
});

it('renders payloads in the shop page as text, never as markup', function (string $payload): void {
    $world = XssWorld::listedShop($this, $payload);
    $shop = $world['shop'];
    $item = $world['item'];

    $response = $this->get('/dukkan/'.$shop->slug);
    $html = XssWorld::ok($response, 'text/html');
    $csp = $response->headers->get('Content-Security-Policy');

    $dom = XssSurface::assertInertPage($html, 3);

    XssSurface::assertNodeText($dom, '//h1', $shop->name);
    XssSurface::assertDisplayedAsText($dom, $shop->address);
    XssSurface::assertDisplayedAsText($dom, $item->name);
    XssSurface::assertNodeText($dom, '//td[1]', $item->name);

    // No external reference (read from attributes), and the policy stays the one of every public page.
    expect($csp)->toBeString()->toContain("script-src 'self'")->not->toContain('unsafe-inline')->not->toContain('unsafe-eval');
})->with(XssPayloads::all());

it('keeps the shop page JSON-LD unbreakable and equal to the stored strings', function (string $payload): void {
    $shop = XssWorld::listedShop($this, $payload)['shop'];

    $html = XssWorld::ok($this->get('/dukkan/'.$shop->slug), 'text/html');

    XssSurface::assertJsonLdBlocks($html, 3);

    $business = XssSurface::jsonLd($html)[1];

    expect($business['name'])->toBe($shop->name)
        ->and($business['address']['streetAddress'])->toBe($shop->address)
        ->and($business['address']['addressRegion'])->toBe($shop->il);

    // The characters that could end or reopen the block are escaped in the markup itself.
    if (str_contains($shop->name, '<')) {
        expect($html)->toContain('<');
    }
})->with(XssPayloads::everything());

it('renders payloads on the district and province pages as text', function (string $payload): void {
    $shop = XssWorld::listedShop($this, $payload)['shop'];

    $district = XssWorld::ok($this->get('/dukkanlar/'.$shop->il_slug.'/'.$shop->ilce_slug), 'text/html');
    $province = XssWorld::ok($this->get('/dukkanlar/'.$shop->il_slug), 'text/html');

    $districtDom = XssSurface::assertInertPage($district, 2);
    $provinceDom = XssSurface::assertInertPage($province, 2);

    XssSurface::assertDisplayedAsText($districtDom, $shop->name);
    XssSurface::assertDisplayedAsText($districtDom, $shop->ilce);
    XssSurface::assertDisplayedAsText($provinceDom, $shop->ilce);

    $crumbs = XssSurface::jsonLd($district)[1]['itemListElement'];
    expect(array_column($crumbs, 'name'))->toBe(['Askıda', $shop->il, $shop->ilce]);
})->with(XssPayloads::everything());

it('keeps the sitemap well-formed with slugs only', function (string $payload): void {
    $shop = XssWorld::listedShop($this, $payload)['shop'];

    $xml = XssWorld::ok($this->get('/sitemap.xml'), 'application/xml');
    $document = XssSurface::xml($xml);
    $document->registerXPathNamespace('s', 'http://www.sitemaps.org/schemas/sitemap/0.9');

    $locations = array_map('strval', $document->xpath('//s:loc') ?: []);

    expect($locations)->toContain('https://askida.app/dukkan/'.$shop->slug)
        ->toContain('https://askida.app/dukkanlar/'.$shop->il_slug.'/'.$shop->ilce_slug);

    // Names never enter the sitemap: every location is a slug path.
    foreach ($locations as $location) {
        expect($location)->toMatch('#^https://askida\.app(/[a-z0-9]+(?:-[a-z0-9]+)*|/[a-z0-9.\-/]*)*$#');
    }
})->with(XssPayloads::everything());

it('draws the payload as pixels in the share image', function (string $payload): void {
    $shop = XssWorld::listedShop($this, $payload)['shop'];

    $response = $this->get('/og/dukkan/'.$shop->slug.'.png');
    $body = XssWorld::ok($response, 'image/png');
    $size = getimagesizefromstring($body);

    expect($size)->not->toBeFalse()
        ->and([$size[0], $size[1], $size['mime']])->toBe([1200, 630, 'image/png'])
        ->and(substr($body, 0, 8))->toBe("\x89PNG\r\n\x1A\n");
})->with(XssPayloads::everything());

it('keeps the plain text site description free of shop input and raw script tags', function (string $payload): void {
    $shop = XssWorld::listedShop($this, $payload)['shop'];

    $response = $this->get('/llms-full.txt');
    $text = XssWorld::ok($response, 'text/plain');

    XssSurface::assertNoRawScript($text, '/llms-full.txt');
    expect($text)->not->toContain($shop->name);
})->with(XssPayloads::all());

it('redirects the short link to the slug path only', function (): void {
    $shop = XssWorld::listedShop($this, '<script>alert(1)</script>')['shop'];

    $this->get('/d/'.$shop->slug)->assertRedirect('/dukkan/'.$shop->slug)->assertStatus(301);
});

it('refuses payloads in a URL slug before any query', function (string $slug): void {
    $this->get('/dukkan/'.$slug)->assertNotFound();
    $this->get('/dukkanlar/'.$slug)->assertNotFound();
    $this->get('/dukkanlar/istanbul/'.$slug)->assertNotFound();
    $this->get('/og/dukkan/'.$slug.'.png')->assertNotFound();
    $this->get('/d/'.$slug)->assertNotFound();
})->with([
    'script element' => [rawurlencode('<script>alert(1)</script>')],
    'attribute breakout' => [rawurlencode('"><svg/onload=alert(1)>')],
    'javascript scheme' => [rawurlencode('javascript:alert(1)')],
    'template syntax' => [rawurlencode('{{7*7}}')],
]);

it('shows nothing of an unverified shop even with a payload name', function (): void {
    $world = XssWorld::listedShop($this, '<script>alert(1)</script>', ShopVerificationState::Pending);

    $this->get('/dukkan/'.$world['shop']->slug)->assertNotFound();
    $xml = XssWorld::ok($this->get('/sitemap.xml'), 'application/xml');

    expect($xml)->not->toContain($world['shop']->slug);
    expect(Shop::query()->count())->toBe(1);
});

it('renders payloads on the payment page as text with the structure of a benign page', function (string $payload): void {
    $world = XssWorld::listedShop($this, $payload);
    $shop = $world['shop'];
    $item = $world['item'];

    $token = 'tok-'.bin2hex(random_bytes(10));
    $donation = Donation::factory()->create([
        'shop_id' => $shop->id,
        'item_id' => $item->id,
        'status' => DonationStatus::Initiated,
        'provider_token' => $token,
    ]);
    app(PayPageStore::class)->put($token, '<form method="post" action="/pay/callback"><input type="hidden" name="token" value="'.$token.'"><button type="submit">Öde</button></form>');

    $html = XssWorld::ok($this->get('/pay/'.$token), 'text/html');
    $dom = XssSurface::dom($html);

    XssSurface::assertNoDangerousAttributes($dom);
    XssSurface::assertNodeText($dom, '//dl/dd[1]', $shop->name);
    XssSurface::assertNodeText($dom, '//dl/dd[2]', $item->name);
    expect($dom->getElementsByTagName('script')->length)->toBe(0);

    $shop->forceFill(['name' => str_repeat('g', mb_strlen($shop->name))])->save();
    $item->forceFill(['name' => str_repeat('g', mb_strlen($item->name))])->save();

    $benign = XssWorld::ok($this->get('/pay/'.$token), 'text/html');
    XssSurface::assertSameStructure($html, $benign, 'pay page');

    expect($donation->refresh()->status)->toBe(DonationStatus::Initiated);
})->with(XssPayloads::everything());
