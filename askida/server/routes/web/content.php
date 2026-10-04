<?php

/*
|--------------------------------------------------------------------------
| Public web: content
|--------------------------------------------------------------------------
|
| Guides, legal pages and llms files: /rehber/{slug}, /gizlilik, /kvkk-aydinlatma, /llms.txt, /llms-full.txt.
| Loaded by routes/web.php. Route names: web.content.<name>. Public GET pages use
| the `cacheResponse:300` middleware (App\Support\Web\ResponseCache\CacheResponse).
|
*/

use App\Http\Controllers\Web\Content\GuideController;
use App\Http\Controllers\Web\Content\LegalController;
use App\Http\Controllers\Web\Content\LlmsController;
use App\Support\Web\ResponseCache\CacheResponse;
use Illuminate\Support\Facades\Route;

Route::middleware(CacheResponse::ALIAS.':300')->group(static function (): void {
    Route::get('/rehber/{slug}', [GuideController::class, 'show'])
        ->where('slug', '[a-z0-9-]+')
        ->name('web.content.guide');

    Route::get('/gizlilik', [LegalController::class, 'show'])
        ->defaults('slug', 'gizlilik')
        ->name('web.content.privacy');

    Route::get('/kvkk-aydinlatma', [LegalController::class, 'show'])
        ->defaults('slug', 'kvkk-aydinlatma')
        ->name('web.content.kvkk');

    Route::get('/llms.txt', [LlmsController::class, 'short'])->name('web.content.llms');
    Route::get('/llms-full.txt', [LlmsController::class, 'full'])->name('web.content.llms-full');
});
