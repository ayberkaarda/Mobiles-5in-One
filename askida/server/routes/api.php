<?php

use Illuminate\Support\Facades\Route;

Route::prefix('v1')->as('api.v1.')->group(function (): void {
    foreach (['auth', 'me', 'shops', 'anon', 'hooks', 'impact', 'accounts'] as $file) {
        $path = __DIR__.'/api/'.$file.'.php';

        if (file_exists($path)) {
            require $path;
        }
    }
});
