<?php

/*
|--------------------------------------------------------------------------
| Public web: seo
|--------------------------------------------------------------------------
|
| Crawler and app linking files: /sitemap.xml, /robots.txt, /.well-known/apple-app-site-association, /.well-known/assetlinks.json.
| Loaded by routes/web.php. Route names: web.seo.<name>. Public GET pages use
| the `cacheResponse:300` middleware (App\Support\Web\ResponseCache\CacheResponse).
|
*/

use App\Http\Controllers\Web\Seo\RobotsController;
use App\Http\Controllers\Web\Seo\SitemapController;
use App\Http\Controllers\Web\Seo\WellKnownController;
use App\Support\Web\ResponseCache\CacheResponse;
use Illuminate\Support\Facades\Route;

// The sitemap is cached for an hour; a change to a listed shop drops it at once.
Route::get('/sitemap.xml', SitemapController::class)
    ->middleware(CacheResponse::ALIAS.':3600')
    ->name('web.seo.sitemap');

Route::middleware(CacheResponse::ALIAS.':'.(int) config('web.response_cache_seconds', 300))->group(function (): void {
    Route::get('/robots.txt', RobotsController::class)->name('web.seo.robots');
    Route::get('/.well-known/apple-app-site-association', [WellKnownController::class, 'appleAppSiteAssociation'])
        ->name('web.seo.apple-app-site-association');
    Route::get('/.well-known/assetlinks.json', [WellKnownController::class, 'assetLinks'])
        ->name('web.seo.assetlinks');
});
