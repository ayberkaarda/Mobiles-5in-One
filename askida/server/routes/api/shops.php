<?php

use App\Http\Controllers\Api\Documents\DocumentController;
use App\Http\Controllers\Api\Items\ItemController;
use App\Http\Controllers\Api\Shops\ShopController;
use Illuminate\Support\Facades\Route;

/*
| Shops, catalog and verification documents. Path parameter names follow the
| authorization matrix (`{slug}`, `{id}`, `{itemId}`); ids are UUIDs, anything else
| is a 404 before any lookup.
*/

Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('shops', [ShopController::class, 'index'])->name('shops.index');
    Route::post('shops', [ShopController::class, 'store'])->name('shops.store');
    Route::get('shops/{slug}', [ShopController::class, 'show'])
        ->where('slug', '[a-z0-9]+(?:-[a-z0-9]+)*')
        ->name('shops.show');

    Route::whereUuid(['id', 'itemId', 'documentId'])->group(function (): void {
        Route::patch('shops/{id}', [ShopController::class, 'update'])->name('shops.update');

        Route::get('shops/{id}/items', [ItemController::class, 'index'])->name('shops.items.index');
        Route::post('shops/{id}/items', [ItemController::class, 'store'])->name('shops.items.store');
        Route::patch('shops/{id}/items/{itemId}', [ItemController::class, 'update'])->name('shops.items.update');

        Route::post('shops/{id}/documents/presign', [DocumentController::class, 'presign'])->name('shops.documents.presign');
        Route::post('shops/{id}/documents/{documentId}/confirm', [DocumentController::class, 'confirm'])->name('shops.documents.confirm');
    });
});
