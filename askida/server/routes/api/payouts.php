<?php

use App\Http\Controllers\Api\Payouts\PayoutLedgerController;
use Illuminate\Support\Facades\Route;

/*
| Payout ledger of a shop (owner only, PayoutPolicy::viewAny). The path parameter name
| follows the authorization matrix (`{id}`); anything but a UUID is a 404.
*/

Route::get('shops/{id}/payouts', PayoutLedgerController::class)
    ->middleware('auth:sanctum')
    ->whereUuid('id')
    ->name('shops.payouts.index');
