<?php

/*
|--------------------------------------------------------------------------
| Public web: directory
|--------------------------------------------------------------------------
|
| Shop directory: /dukkanlar/{il}, /dukkanlar/{il}/{ilce}, /dukkan/{slug}, /d/{slug} (301), /og/dukkan/{slug}.png.
| Loaded by routes/web.php. Route names: web.directory.<name>. Public GET pages use
| the `cacheResponse:300` middleware (App\Support\Web\ResponseCache\CacheResponse).
|
*/

use App\Domain\Web\Directory\DirectoryQuery;
use App\Http\Controllers\Web\Directory\DistrictController;
use App\Http\Controllers\Web\Directory\OgImageController;
use App\Http\Controllers\Web\Directory\ShopPageController;
use App\Support\Web\ResponseCache\CacheResponse;
use Illuminate\Support\Facades\Route;

// Slugs are lower-case ASCII (App\Support\Web\TurkishSlug); anything else is a 404.
Route::middleware(CacheResponse::ALIAS.':'.(int) config('web.response_cache_seconds', 300))->group(function (): void {
    Route::get('/dukkanlar/{il}', [DistrictController::class, 'province'])
        ->where('il', DirectoryQuery::SLUG_PATTERN)
        ->name('web.directory.province');
    Route::get('/dukkanlar/{il}/{ilce}', [DistrictController::class, 'district'])
        ->where(['il' => DirectoryQuery::SLUG_PATTERN, 'ilce' => DirectoryQuery::SLUG_PATTERN])
        ->name('web.directory.district');
    Route::get('/dukkan/{slug}', [ShopPageController::class, 'show'])
        ->where('slug', DirectoryQuery::SLUG_PATTERN)
        ->name('web.directory.shop');
    Route::get('/d/{slug}', [ShopPageController::class, 'shortLink'])
        ->where('slug', DirectoryQuery::SLUG_PATTERN)
        ->name('web.directory.short');
});

// Share images keep their own cache: a file on the public disk and a one-day Cache-Control.
Route::get('/og/dukkan/{slug}.png', OgImageController::class)
    ->where('slug', DirectoryQuery::SLUG_PATTERN)
    ->name('web.directory.og');
