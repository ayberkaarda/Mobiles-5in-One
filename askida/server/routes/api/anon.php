<?php

use App\Http\Controllers\Api\Anon\AnonDeviceController;
use App\Http\Controllers\Api\Anon\AttestController;
use Illuminate\Support\Facades\Route;

/*
| Anonymous recipient devices. Anon tokens are accepted only on routes that demand
| the anon ability (`abilities:anon`), see App\Domain\Anon\Auth\AnonTokenRule.
*/

Route::post('anon/attest', AttestController::class)
    ->middleware('throttle:anon-attest')
    ->name('anon.attest');

Route::middleware(['auth:sanctum', 'abilities:anon'])->group(function (): void {
    Route::delete('anon/me', [AnonDeviceController::class, 'destroy'])->name('anon.me.destroy');
});
