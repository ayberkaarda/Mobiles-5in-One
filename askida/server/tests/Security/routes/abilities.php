<?php

use Illuminate\Support\Facades\Route;

/*
| Test-only routes: one group per token ability, guarded the way later endpoints will
| be (auth:sanctum, then ability:<name>). Loaded by AbilityMiddlewareTest only.
*/

Route::middleware(['api', 'auth:sanctum'])->prefix('api/v1/test-abilities')->group(function (): void {
    foreach (['donor', 'merchant', 'anon'] as $ability) {
        Route::get($ability, fn (): array => ['ability' => $ability])->middleware('ability:'.$ability);
    }

    Route::get('user', fn (): array => ['ability' => 'user'])->middleware('ability:donor,merchant');
    Route::get('all', fn (): array => ['ability' => 'all'])->middleware('abilities:donor,merchant');
});
