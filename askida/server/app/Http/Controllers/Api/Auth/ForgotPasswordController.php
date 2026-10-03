<?php

namespace App\Http\Controllers\Api\Auth;

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ForgotPasswordRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;

class ForgotPasswordController extends Controller
{
    /**
     * Always 202 with the same body, whether or not the email belongs to an account.
     * The reset code mail is queued, so the response does not wait for delivery.
     */
    public function __invoke(ForgotPasswordRequest $request, OneTimeCodeService $codes): JsonResponse
    {
        $user = User::query()->where('email', $request->emailAddress())->first();

        if ($user !== null && ! $user->isDeactivated()) {
            $codes->sendPasswordReset($user);
        }

        return new JsonResponse(['status' => 'accepted'], 202);
    }
}
