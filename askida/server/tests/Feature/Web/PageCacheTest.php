<?php

use App\Domain\Web\Contracts\CountersReader;
use App\Support\Web\ResponseCache\PageCache;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Route;
use Tests\Fakes\FakeCountersReader;
use Tests\Feature\Web\Support\WebPage;

/*
| Mechanics of the `cacheResponse` route middleware (App\Support\Web\ResponseCache): what
| is stored, what is served from the store and what always bypasses it. The page cache is
| off under tests by default; these tests turn it on with a private array store.
*/

beforeEach(function (): void {
    WebPage::isolate();

    config([
        'responsecache.enabled' => true,
        'responsecache.store' => 'array',
    ]);

    Cache::store('array')->flush();

    $this->app->instance(CountersReader::class, $this->counters = new FakeCountersReader);
});

it('stores the first answer and serves the next one from the store with fresh headers', function (): void {
    $first = $this->get('/');
    $second = $this->get('/');

    $first->assertOk()->assertHeader('X-Page-Cache', 'miss');
    $second->assertOk()->assertHeader('X-Page-Cache', 'hit');

    expect($second->getContent())->toBe($first->getContent())
        ->and($this->counters->homeCalls)->toBe(1)
        ->and($second->headers->get('Content-Type'))->toBe('text/html; charset=utf-8')
        ->and($second->headers->get('Content-Security-Policy'))->not->toBe($first->headers->get('Content-Security-Policy'))
        ->and($second->headers->get('X-Content-Type-Options'))->toBe('nosniff');
});

it('never caches a request with a query string', function (): void {
    $this->get('/?a=1')->assertOk()->assertHeaderMissing('X-Page-Cache');
    $this->get('/?a=1')->assertOk()->assertHeaderMissing('X-Page-Cache');

    expect($this->counters->homeCalls)->toBe(2);
});

it('forgets a page on demand', function (): void {
    $this->get('/')->assertHeader('X-Page-Cache', 'miss');

    app(PageCache::class)->forget('/');

    $this->get('/')->assertHeader('X-Page-Cache', 'miss');
});

it('does nothing while turned off', function (): void {
    config(['responsecache.enabled' => false]);

    $this->get('/')->assertOk()->assertHeaderMissing('X-Page-Cache');
    $this->get('/')->assertOk()->assertHeaderMissing('X-Page-Cache');

    expect($this->counters->homeCalls)->toBe(2);
});

it('stores neither errors, no-store answers nor answers that set a cookie', function (int $status, array $headers, bool $cookie): void {
    Route::middleware(['web', 'cacheResponse:300'])->get('/test-page-cache/{n}', static function () use ($status, $headers, $cookie) {
        $response = response('body', $status, $headers);

        return $cookie ? $response->cookie('flavour', 'x') : $response;
    });

    $this->get('/test-page-cache/1')->assertHeader('X-Page-Cache', 'miss');
    $this->get('/test-page-cache/1')->assertHeader('X-Page-Cache', 'miss');
})->with([
    'not found' => [404, [], false],
    'no-store' => [200, ['Cache-Control' => 'no-store'], false],
    'own cookie' => [200, [], true],
]);

it('keys pages by path only', function (): void {
    $pages = app(PageCache::class);

    expect($pages->key('/dukkan/ornek'))->toBe($pages->key('dukkan/ornek/'))
        ->and($pages->key('/dukkan/ornek'))->not->toBe($pages->key('/dukkan/diger'))
        ->and($pages->key('/'))->toStartWith('web-page:v1:');
});
