<?php

namespace App\Http\Controllers\Api\Auth;

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Enums\OneTimeCodePurpose;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\VerifyEmailRequest;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;

class VerifyEmailController extends Controller
{
    /**
     * Confirms the email address with the mailed code. Works without a token: the code
     * is the credential. Unknown email, wrong, used or expired code answer the same.
     */
    public function __invoke(VerifyEmailRequest $request, OneTimeCodeService $codes): JsonResponse
    {
        $user = User::query()->where('email', $request->emailAddress())->first();

        if ($user === null
            || $user->isDeactivated()
            || ! $codes->consume($user, OneTimeCodePurpose::EmailVerification, $request->string('code')->value())) {
            throw ProblemException::make(ProblemCode::TokenInvalid, 422);
        }

        if (! $user->hasVerifiedEmail()) {
            $user->markEmailAsVerified();
        }

        return new JsonResponse(['email_verified' => true]);
    }
}
