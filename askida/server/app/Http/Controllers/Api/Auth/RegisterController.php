<?php

namespace App\Http\Controllers\Api\Auth;

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Consent\KvkkConsentRecorder;
use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Http\Controllers\Api\Auth\Concerns\RespondsWithToken;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class RegisterController extends Controller
{
    use RespondsWithToken;

    public function __invoke(
        RegisterRequest $request,
        KvkkConsentRecorder $consents,
        OneTimeCodeService $codes,
        DeviceTokenIssuer $tokens,
    ): JsonResponse {
        try {
            [$user, $token] = DB::transaction(function () use ($request, $consents, $codes, $tokens): array {
                $user = new User;
                $user->forceFill([
                    'email' => $request->emailAddress(),
                    'password' => $request->string('password')->value(),
                    'name' => $request->string('name')->value(),
                    'kind' => $request->kind(),
                ])->save();

                $consents->record($user, $request->string('kvkk_text_version')->value(), (string) $request->ip());
                $codes->sendEmailVerification($user);

                $token = $tokens->issue(
                    $user,
                    $request->string('device_name')->value(),
                    $request->string('platform')->value(),
                );

                return [$user, $token];
            });
        } catch (UniqueConstraintViolationException) {
            throw ProblemException::make(
                ProblemCode::ValidationFailed,
                422,
                errors: [['field' => 'email', 'code' => 'unique']],
            );
        }

        return $this->tokenResponse($user, $token, 201);
    }
}
