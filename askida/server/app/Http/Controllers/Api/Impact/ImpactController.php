<?php

namespace App\Http\Controllers\Api\Impact;

use App\Domain\Impact\Services\ImpactReader;
use App\Http\Controllers\Controller;
use App\Http\Requests\Impact\ImpactRequest;
use Illuminate\Http\JsonResponse;

/**
 * GET impact?il=&ilce=: public aggregate counters of the latest snapshot day. Counts
 * only; no shop, donor or recipient data.
 */
class ImpactController extends Controller
{
    public function __invoke(ImpactRequest $request, ImpactReader $reader): JsonResponse
    {
        return response()->json(['data' => $reader->latest($request->il(), $request->ilce())]);
    }
}
