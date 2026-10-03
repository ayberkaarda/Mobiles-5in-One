<?php

namespace App\Http\Controllers\Api\Auth;

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Enums\OneTimeCodePurpose;
use App\Domain\Auth\Lockout\LoginLockout;
use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ResetPasswordRequest;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class ResetPasswordController extends Controller
{
    /**
     * Sets a new password with the mailed code and revokes every token of the user.
     * A successful reset also proves ownership of the address, so it verifies the email.
     */
    public function __invoke(
        ResetPasswordRequest $request,
        OneTimeCodeService $codes,
        DeviceTokenIssuer $tokens,
        LoginLockout $lockout,
    ): Response {
        $user = User::query()->where('email', $request->emailAddress())->first();

        if ($user === null
            || $user->isDeactivated()
            || ! $codes->consume($user, OneTimeCodePurpose::PasswordReset, $request->string('code')->value())) {
            throw ProblemException::make(ProblemCode::TokenInvalid, 422);
        }

        DB::transaction(function () use ($user, $request, $tokens): void {
            $user->forceFill([
                'password' => $request->string('password')->value(),
                'email_verified_at' => $user->email_verified_at ?? Carbon::now(),
            ])->save();

            $tokens->revokeAll($user);
        });

        $lockout->clear($user->email, (string) $request->ip());

        return response()->noContent();
    }
}
