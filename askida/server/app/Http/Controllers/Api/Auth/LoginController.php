<?php

namespace App\Http\Controllers\Api\Auth;

use App\Domain\Auth\Lockout\LoginLockout;
use App\Domain\Auth\Passwords\CredentialChecker;
use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Http\Controllers\Api\Auth\Concerns\RespondsWithToken;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;

class LoginController extends Controller
{
    use RespondsWithToken;

    public function __invoke(
        LoginRequest $request,
        LoginLockout $lockout,
        CredentialChecker $credentials,
        DeviceTokenIssuer $tokens,
    ): JsonResponse {
        $email = $request->emailAddress();
        $ip = (string) $request->ip();

        $remaining = $lockout->secondsRemaining($email, $ip);

        if ($remaining > 0) {
            throw ProblemException::make(ProblemCode::Locked, 429, headers: ['Retry-After' => (string) $remaining]);
        }

        $password = $request->string('password')->value();
        $user = User::query()->where('email', $email)->first();

        if ($user === null || ! $credentials->check($user, $password)) {
            if ($user === null) {
                // Same hashing work as for a known email.
                $credentials->check(null, $password);
            }

            $lockout->recordFailure($email, $ip);

            throw ProblemException::make(ProblemCode::InvalidCredentials, 401);
        }

        $lockout->clear($email, $ip);

        if ($user->password !== null && Hash::needsRehash($user->password)) {
            $user->forceFill(['password' => $password])->save();
        }

        $token = $tokens->issue(
            $user,
            $request->string('device_name')->value(),
            $request->string('platform')->value(),
        );

        return $this->tokenResponse($user, $token);
    }
}
