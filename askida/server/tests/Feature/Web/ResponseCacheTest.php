<?php

use App\Models\User;
use App\Support\Web\ResponseCache\CacheResponse;
use App\Support\Web\ResponseCache\PageCache;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Web\Seo\Support\PublicSite;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| Public page cache as wired on the routes (contract: public GET routes use
| `cacheResponse:300`, the sitemap 3600; /hesap-silme, /pay/*, /admin/*, /etki.csv and /og/*
| never go through it). The page cache is the in-house replacement of
| spatie/laravel-responsecache (App\Support\Web\ResponseCache, ADR-0043): what it stores
| and what it serves is proven here on the real pages; PageCacheTest covers the middleware
| mechanics on synthetic routes.
*/

beforeEach(function (): void {
    WebPage::isolate();
    Storage::fake('public');

    config([
        'web.origin' => 'https://askida.app',
        'askida.allow_sample_shops' => false,
        'responsecache.enabled' => true,
        'responsecache.store' => 'array',
    ]);

    Cache::store('array')->flush();
});

/**
 * The page cache lifetime of a route, or null when the route does not use it.
 */
function pageCacheSeconds(RoutingRoute $route): ?int
{
    foreach ($route->gatherMiddleware() as $middleware) {
        if (is_string($middleware) && str_starts_with($middleware, CacheResponse::ALIAS.':')) {
            return (int) substr($middleware, strlen(CacheResponse::ALIAS) + 1);
        }

        if ($middleware === CacheResponse::ALIAS || $middleware === CacheResponse::class) {
            return 0;
        }
    }

    return null;
}

it('puts every public GET page behind the page cache and keeps the private ones out', function (): void {
    $cached = [];
    $uncached = [];

    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (! in_array('GET', $route->methods(), true)) {
            continue;
        }

        $name = (string) $route->getName();
        $seconds = pageCacheSeconds($route);

        if ($seconds === null) {
            $uncached[] = $name !== '' ? $name : $route->uri();
        } else {
            $cached[$name] = $seconds;
        }
    }

    $expected = [
        'web.pages.home', 'web.pages.home-en', 'web.pages.how-it-works', 'web.pages.how-it-works-en',
        'web.pages.merchants', 'web.pages.donors', 'web.pages.recipients', 'web.pages.faq',
        'web.pages.about', 'web.pages.contact',
        'web.content.guide', 'web.content.privacy', 'web.content.kvkk', 'web.content.llms', 'web.content.llms-full',
        'web.directory.province', 'web.directory.district', 'web.directory.shop', 'web.directory.short',
        'web.impact.index', 'web.impact.province',
        'web.seo.robots', 'web.seo.apple-app-site-association', 'web.seo.assetlinks', 'web.seo.sitemap',
    ];

    expect(array_keys($cached))->toEqualCanonicalizing($expected);

    foreach ($cached as $name => $seconds) {
        expect($seconds)->toBe($name === 'web.seo.sitemap' ? 3600 : 300, "page cache lifetime of {$name}");
    }

    foreach (['web.account-deletion.show', 'web.pay.show', 'web.impact.csv', 'web.directory.og'] as $name) {
        expect($uncached)->toContain($name);
    }

    // Nothing of the admin panel, the API or the health check is cached.
    foreach (array_keys($cached) as $name) {
        expect($name)->toStartWith('web.');
    }
});

it('serves every public page from the store on the second request with fresh security headers', function (): void {
    foreach (PublicSite::seed() as $path => $lang) {
        $first = $this->get($path);
        $second = $this->get($path);

        $first->assertOk()->assertHeader('X-Page-Cache', 'miss');
        $second->assertOk()->assertHeader('X-Page-Cache', 'hit');

        expect($second->getContent())->toBe($first->getContent(), $path)
            ->and($second->headers->get('Content-Type'))->toBe('text/html; charset=utf-8')
            ->and($second->headers->get('Content-Security-Policy'))->toBeString()->not->toBe($first->headers->get('Content-Security-Policy'), "nonce of {$path}")
            ->and($second->headers->get('X-Content-Type-Options'))->toBe('nosniff');

        // A cached page is still a valid public page (it relies on no nonce).
        WebPage::assertPublicPage($second, $lang, WebPage::BUDGET_LONG);

        $entry = app(PageCache::class)->get(app(PageCache::class)->key($path));
        expect($entry)->not->toBeNull()
            ->and(array_diff(array_keys($entry['headers'] ?? []), PageCache::KEPT_HEADERS))->toBe([], "stored headers of {$path}");
    }
});

it('never caches the account deletion page', function (): void {
    $first = $this->get('/hesap-silme');
    $second = $this->get('/hesap-silme');

    $first->assertOk()->assertHeaderMissing('X-Page-Cache');
    $second->assertOk()->assertHeaderMissing('X-Page-Cache');

    expect(app(PageCache::class)->get(app(PageCache::class)->key('/hesap-silme')))->toBeNull();
});

it('keeps the open data CSV and the share images on their own cache', function (): void {
    PublicSite::seed();

    $csv = $this->get('/etki.csv')->assertOk()->assertHeaderMissing('X-Page-Cache');
    expect($csv->headers->get('Cache-Control'))->toContain('max-age=3600');

    $og = $this->get('/og/dukkan/'.PublicSite::SHOP_SLUG.'.png')->assertOk()->assertHeaderMissing('X-Page-Cache');
    expect($og->headers->get('Cache-Control'))->toContain('max-age=86400');

    expect(app(PageCache::class)->get(app(PageCache::class)->key('/etki.csv')))->toBeNull()
        ->and(app(PageCache::class)->get(app(PageCache::class)->key('/og/dukkan/'.PublicSite::SHOP_SLUG.'.png')))->toBeNull();
});

it('serves a signed-in visitor the live page', function (): void {
    $this->actingAs(User::factory()->create());

    $this->get('/sss')->assertOk()->assertHeaderMissing('X-Page-Cache');
    $this->get('/sss')->assertOk()->assertHeaderMissing('X-Page-Cache');

    expect(app(PageCache::class)->get(app(PageCache::class)->key('/sss')))->toBeNull();
});

it('does not store a missing page', function (): void {
    $this->get('/dukkan/olmayan-dukkan')->assertNotFound();
    $this->get('/rehber/olmayan-rehber')->assertNotFound();
    $this->get('/etki/olmayan-il')->assertNotFound();

    foreach (['/dukkan/olmayan-dukkan', '/rehber/olmayan-rehber', '/etki/olmayan-il'] as $path) {
        expect(app(PageCache::class)->get(app(PageCache::class)->key($path)))->toBeNull($path);
    }
});

it('expires a page after its lifetime', function (): void {
    $this->get('/esnaf')->assertHeader('X-Page-Cache', 'miss');

    $this->travel(299)->seconds();
    $this->get('/esnaf')->assertHeader('X-Page-Cache', 'hit');

    $this->travel(2)->seconds();
    $this->get('/esnaf')->assertHeader('X-Page-Cache', 'miss');
});

it('uses the shared redis store outside tests and is on by default outside the testing environment', function (): void {
    $source = (string) file_get_contents(config_path('responsecache.php'));

    expect($source)->toContain("env('RESPONSE_CACHE_STORE', 'redis')")
        ->and($source)->toContain("env('APP_ENV') !== 'testing'");
});
