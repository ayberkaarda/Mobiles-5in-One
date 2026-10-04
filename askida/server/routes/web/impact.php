<?php

use App\Http\Controllers\Web\Impact\CsvController;
use App\Http\Controllers\Web\Impact\ImpactController;
use App\Http\Controllers\Web\Impact\ProvinceController;
use App\Support\Web\ResponseCache\CacheResponse;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public web: impact
|--------------------------------------------------------------------------
|
| Impact pages: /etki, /etki/{il}, /etki.csv.
| Loaded by routes/web.php. Route names: web.impact.<name>. Public GET pages use
| the `cacheResponse:300` middleware (App\Support\Web\ResponseCache\CacheResponse);
| the CSV keeps its own one hour cache.
|
*/

Route::get('/etki', ImpactController::class)
    ->middleware(CacheResponse::ALIAS.':300')
    ->name('web.impact.index');

Route::get('/etki.csv', CsvController::class)->name('web.impact.csv');

Route::get('/etki/{il}', ProvinceController::class)
    ->where('il', '[a-z0-9-]+')
    ->middleware(CacheResponse::ALIAS.':300')
    ->name('web.impact.province');
