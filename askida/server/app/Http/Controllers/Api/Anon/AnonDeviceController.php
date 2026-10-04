<?php

namespace App\Http\Controllers\Api\Anon;

use App\Domain\Anon\Auth\RequestPrincipal;
use App\Domain\Anon\Services\AnonDeviceEraser;
use App\Http\Controllers\Controller;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * DELETE anon/me (anon token): the device erases itself.
 */
class AnonDeviceController extends Controller
{
    public function destroy(Request $request, AnonDeviceEraser $eraser): Response
    {
        $device = RequestPrincipal::anonDevice($request);

        if ($device === null) {
            throw ProblemException::make(ProblemCode::Forbidden, 403);
        }

        $eraser->erase($device);

        return response()->noContent();
    }
}
