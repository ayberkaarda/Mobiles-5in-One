<?php

use App\Http\Controllers\Api\Donations\DonationController;
use Illuminate\Support\Facades\Route;

/*
| Donations of the calling donor. Authorization: DonationPolicy (form requests and the
| controller); limiter `donations-create` (PaymentsServiceProvider).
*/

Route::middleware('auth:sanctum')->group(function (): void {
    Route::post('donations', [DonationController::class, 'store'])
        ->middleware('throttle:donations-create')
        ->name('donations.store');

    Route::get('donations', [DonationController::class, 'index'])->name('donations.index');

    Route::get('donations/{id}', [DonationController::class, 'show'])
        ->whereUuid('id')
        ->name('donations.show');
});
