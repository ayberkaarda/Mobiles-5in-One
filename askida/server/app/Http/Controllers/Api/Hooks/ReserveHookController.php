<?php

namespace App\Http\Controllers\Api\Hooks;

use App\Domain\Anon\Auth\RequestPrincipal;
use App\Domain\Hooks\Services\HookReservationService;
use App\Http\Controllers\Controller;
use App\Http\Requests\Hooks\ReserveHookRequest;
use App\Http\Resources\HookReservationResource;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;

/**
 * POST hooks/reserve (anon token; limiter `hooks-reserve`). Authorized by the form
 * request (`reserve` on Hook) before validation.
 */
class ReserveHookController extends Controller
{
    public function __invoke(ReserveHookRequest $request, HookReservationService $reservations): JsonResponse
    {
        $device = RequestPrincipal::anonDevice($request);

        if ($device === null) {
            throw ProblemException::make(ProblemCode::Forbidden, 403);
        }

        $reservation = $reservations->reserve(
            $device,
            $request->string('shop_id')->value(),
            $request->string('item_id')->value(),
        );

        return (new HookReservationResource($reservation))->response()->setStatusCode(201);
    }
}
