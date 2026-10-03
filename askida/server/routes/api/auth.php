<?php

use App\Http\Controllers\Api\Auth\ForgotPasswordController;
use App\Http\Controllers\Api\Auth\LoginController;
use App\Http\Controllers\Api\Auth\LogoutController;
use App\Http\Controllers\Api\Auth\RegisterController;
use App\Http\Controllers\Api\Auth\ResetPasswordController;
use App\Http\Controllers\Api\Auth\SocialLoginController;
use App\Http\Controllers\Api\Auth\VerifyEmailController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->as('auth.')->group(function (): void {
    Route::middleware('throttle:auth')->group(function (): void {
        Route::post('register', RegisterController::class)->name('register');
        Route::post('login', LoginController::class)->name('login');
        Route::post('apple', [SocialLoginController::class, 'apple'])->name('apple');
        Route::post('google', [SocialLoginController::class, 'google'])->name('google');
        Route::post('verify-email', VerifyEmailController::class)->name('verify-email');
        Route::post('forgot', ForgotPasswordController::class)->name('forgot');
        Route::post('reset', ResetPasswordController::class)->name('reset');
    });

    Route::post('logout', LogoutController::class)->middleware('auth:sanctum')->name('logout');
});
