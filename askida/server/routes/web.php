<?php

use App\Http\Controllers\Web\AccountDeletionController;
use App\Http\Controllers\Web\PayController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

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
