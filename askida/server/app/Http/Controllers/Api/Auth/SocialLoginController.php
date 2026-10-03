<?php

namespace App\Http\Controllers\Api\Auth;

use App\Domain\Auth\Consent\KvkkConsentRecorder;
use App\Domain\Auth\Contracts\IdentityTokenVerifier;
use App\Domain\Auth\Enums\IdentityProvider;
use App\Domain\Auth\Identity\VerifiedIdentity;
use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Http\Controllers\Api\Auth\Concerns\RespondsWithToken;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\SocialLoginRequest;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\NewAccessToken;

/**
 * Sign in with Apple and Google.
 *
 * Account resolution, in order:
 * 1. a user with this provider subject signs in;
 * 2. else a user with the token's email is linked to the subject, only when the
 *    provider asserts the email is verified (otherwise 409 `conflict`) and the
 *    account has no other subject of this provider. When the existing account had
 *    not verified its email, its password and tokens are discarded: the provider
 *    proved ownership of the address, the earlier password did not;
 * 3. else a new account is created with `password = NULL` (requires `kind` and
 *    `kvkk_text_version`).
 */
class SocialLoginController extends Controller
{
    use RespondsWithToken;

    public function __construct(
        private readonly IdentityTokenVerifier $verifier,
        private readonly DeviceTokenIssuer $tokens,
        private readonly KvkkConsentRecorder $consents,
    ) {}

    public function apple(SocialLoginRequest $request): JsonResponse
    {
        return $this->signIn(IdentityProvider::Apple, $request);
    }

    public function google(SocialLoginRequest $request): JsonResponse
    {
        return $this->signIn(IdentityProvider::Google, $request);
    }

    private function signIn(IdentityProvider $provider, SocialLoginRequest $request): JsonResponse
    {
        $identity = $this->verifier->verify(
            $provider,
            $request->string('id_token')->value(),
            $request->string('nonce')->value(),
        );

        /** @var array{0: User, 1: NewAccessToken, 2: bool} $result */
        $result = DB::transaction(function () use ($provider, $identity, $request): array {
            $column = $provider->subjectColumn();
            $created = false;

            $user = User::query()->where($column, $identity->sub)->lockForUpdate()->first()
                ?? $this->linkByEmail($column, $identity);

            if ($user === null) {
                $user = $this->createAccount($column, $identity, $request);
                $created = true;
            }

            if ($user->isDeactivated()) {
                throw ProblemException::make(ProblemCode::InvalidCredentials, 401);
            }

            $token = $this->tokens->issue(
                $user,
                $request->string('device_name')->value(),
                $request->string('platform')->value(),
            );

            return [$user, $token, $created];
        });

        [$user, $token, $created] = $result;

        return $this->tokenResponse($user, $token, $created ? 201 : 200);
    }

    private function linkByEmail(string $column, VerifiedIdentity $identity): ?User
    {
        if ($identity->email === null) {
            return null;
        }

        $user = User::query()->where('email', $identity->email)->lockForUpdate()->first();

        if ($user === null) {
            return null;
        }

        if (! $identity->emailVerified || $user->getAttribute($column) !== null) {
            throw ProblemException::make(ProblemCode::Conflict, 409);
        }

        $attributes = [$column => $identity->sub];

        if (! $user->hasVerifiedEmail()) {
            $attributes['email_verified_at'] = Carbon::now();
            $attributes['password'] = null;
            $this->tokens->revokeAll($user);
        }

        $user->forceFill($attributes)->save();

        return $user;
    }

    private function createAccount(string $column, VerifiedIdentity $identity, SocialLoginRequest $request): User
    {
        $email = $identity->email;
        $kind = $request->kind();
        $errors = [];

        if ($email === null) {
            $errors[] = ['field' => 'id_token', 'code' => 'email_missing'];
        }

        if ($kind === null) {
            $errors[] = ['field' => 'kind', 'code' => 'required'];
        }

        if (! $request->filled('kvkk_text_version')) {
            $errors[] = ['field' => 'kvkk_text_version', 'code' => 'required'];
        }

        if ($email === null || $kind === null || $errors !== []) {
            throw ProblemException::make(ProblemCode::ValidationFailed, 422, errors: $errors);
        }

        $name = $request->filled('name')
            ? $request->string('name')->value()
            : ($identity->name ?? Str::before($email, '@'));

        $user = new User;
        $user->forceFill([
            'email' => $email,
            'email_verified_at' => $identity->emailVerified ? Carbon::now() : null,
            'password' => null,
            $column => $identity->sub,
            'name' => Str::limit($name, 100, ''),
            'kind' => $kind,
        ])->save();

        $this->consents->record($user, $request->string('kvkk_text_version')->value(), (string) $request->ip());

        return $user;
    }
}
