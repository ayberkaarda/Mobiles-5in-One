<?php

use App\Domain\Web\Contracts\CountersReader;
use App\Http\Controllers\Web\AccountDeletionController;
use App\Http\Controllers\Web\PayController;
use App\Support\Web\ResponseCache\CacheResponse;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;
use Illuminate\View\View;

// Temporary home: renders the public layout with the bound counters until the pages area
// registers `/` in routes/web/pages.php (loaded below, so its route replaces this one; the
// preview view and this route are then removed).
Route::get('/', static fn (CountersReader $counters): View => view('web.layouts.preview', ['counters' => $counters->home()]))
    ->middleware(CacheResponse::ALIAS.':300');

// Account deletion for email and password accounts (security checklist item 21).
Route::get('/hesap-silme', [AccountDeletionController::class, 'show'])->name('web.account-deletion.show');
Route::post('/hesap-silme', [AccountDeletionController::class, 'store'])
    ->middleware('throttle:auth')
    ->name('web.account-deletion.store');

// region payments (pay page and provider callback; filled by the payments area)
// The callback is a cross-site POST from the payment provider, so CSRF verification is
// off for it; it reads only the token and re-reads the payment server side.
Route::post('/pay/callback', [PayController::class, 'callback'])
    ->middleware('throttle:pay-callback')
    ->withoutMiddleware(PreventRequestForgery::class)
    ->name('web.pay.callback');
Route::get('/pay/{token}', [PayController::class, 'show'])->name('web.pay.show');
// endregion payments

// Public web areas (each file is owned by one area; see the file headers).
require __DIR__.'/web/pages.php';
require __DIR__.'/web/directory.php';
require __DIR__.'/web/impact.php';
require __DIR__.'/web/content.php';
require __DIR__.'/web/seo.php';
