<?php

use App\Http\Controllers\Api\Impact\ImpactController;
use Illuminate\Support\Facades\Route;

// Public: aggregate counters only.
Route::get('impact', ImpactController::class)->name('impact.show');
