<?php

use App\Http\Controllers\Web\Pages\PagesController;
use App\Support\Web\ResponseCache\CacheResponse;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public web: pages
|--------------------------------------------------------------------------
|
| Public pages: /, /en, /nasil-calisir, /en/how-it-works, /esnaf, /bagisci, /askidan-al, /sss, /hakkinda, /iletisim.
| Loaded by routes/web.php. Route names: web.pages.<name>. Public GET pages use
| the `cacheResponse:300` middleware (App\Support\Web\ResponseCache\CacheResponse).
|
*/
Route::middleware(CacheResponse::ALIAS.':300')->group(function (): void {
    Route::get('/', [PagesController::class, 'home'])->name('web.pages.home');
    Route::get('/en', [PagesController::class, 'homeEn'])->name('web.pages.home-en');
    Route::get('/nasil-calisir', [PagesController::class, 'howItWorks'])->name('web.pages.how-it-works');
    Route::get('/en/how-it-works', [PagesController::class, 'howItWorksEn'])->name('web.pages.how-it-works-en');
    Route::get('/esnaf', [PagesController::class, 'merchants'])->name('web.pages.merchants');
    Route::get('/bagisci', [PagesController::class, 'donors'])->name('web.pages.donors');
    Route::get('/askidan-al', [PagesController::class, 'recipients'])->name('web.pages.recipients');
    Route::get('/sss', [PagesController::class, 'faq'])->name('web.pages.faq');
    Route::get('/hakkinda', [PagesController::class, 'about'])->name('web.pages.about');
    Route::get('/iletisim', [PagesController::class, 'contact'])->name('web.pages.contact');
});
