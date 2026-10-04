<?php

use App\Http\Controllers\Api\Webhooks\IyzicoWebhookController;
use Illuminate\Support\Facades\Route;

/*
| Provider webhooks (security item 17). No bearer authentication: the delivery is
| authenticated by its signature over the raw body. Limiter `webhooks` (120/min per IP,
| PaymentsServiceProvider). Request bodies and headers are never logged (LogRequest).
*/

Route::post('webhooks/iyzico', IyzicoWebhookController::class)
    ->middleware('throttle:webhooks')
    ->name('webhooks.iyzico');
