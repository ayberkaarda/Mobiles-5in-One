<?php

use App\Http\Controllers\Api\Hooks\RedeemHookController;
use App\Http\Controllers\Api\Hooks\RedemptionListController;
use App\Http\Controllers\Api\Hooks\ReserveHookController;
use Illuminate\Support\Facades\Route;

/*
| Reservation (anon) and redemption (shop members). Authorization: HookPolicy through
| the form requests; limiters `hooks-reserve` and `redeem` (AnonServiceProvider).
*/

Route::post('hooks/reserve', ReserveHookController::class)
    ->middleware(['auth:sanctum', 'abilities:anon', 'throttle:hooks-reserve'])
    ->name('hooks.reserve');

Route::middleware('auth:sanctum')->group(function (): void {
    Route::post('shops/{shop}/redeem', RedeemHookController::class)
        ->middleware('throttle:redeem')
        ->whereUuid('shop')
        ->name('shops.redeem');

    Route::get('shops/{shop}/redemptions', RedemptionListController::class)
        ->whereUuid('shop')
        ->name('shops.redemptions');
});
