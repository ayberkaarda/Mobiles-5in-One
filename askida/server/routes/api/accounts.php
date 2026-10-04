<?php

use App\Http\Controllers\Api\Accounts\DeleteAccountController;
use App\Http\Controllers\Api\Accounts\PushTokenController;
use Illuminate\Support\Facades\Route;

// User accounts only: an anonymous device token never reaches these actions.
Route::middleware(['auth:sanctum', 'ability:donor,merchant'])->group(function (): void {
    Route::put('me/push-token', PushTokenController::class)->name('me.push-token');

    // Re-authentication guesses share the sign-in limiter.
    Route::delete('me', DeleteAccountController::class)->middleware('throttle:auth')->name('me.destroy');
});
