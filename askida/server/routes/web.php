<?php

use App\Http\Controllers\Web\AccountDeletionController;
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
// endregion payments
