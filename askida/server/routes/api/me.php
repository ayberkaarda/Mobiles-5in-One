<?php

use App\Http\Controllers\Api\MeController;
use App\Http\Controllers\Api\Shops\MyShopsController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('me', [MeController::class, 'show'])->name('me.show');
    Route::patch('me', [MeController::class, 'update'])->name('me.update');
    // Shops of the calling merchant (owner or staff); donors get 403 from ShopPolicy::viewMine.
    Route::get('me/shops', MyShopsController::class)->name('me.shops');
});
