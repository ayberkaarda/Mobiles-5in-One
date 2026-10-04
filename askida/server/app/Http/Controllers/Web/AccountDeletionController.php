<?php

namespace App\Http\Controllers\Web;

use App\Domain\Accounts\Services\AccountDeletionService;
use App\Domain\Auth\Models\DeletionChannel;
use App\Domain\Auth\Passwords\CredentialChecker;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Web page /hesap-silme: account deletion for email and password accounts, using the
 * same service as DELETE /api/v1/me. Apple and Google accounts are sent to the app.
 *
 * Unknown email, wrong password, provider-only and already closed accounts all get the
 * same answer (the credential check hashes in every case), so the page does not reveal
 * whether an address has an account.
 */
class AccountDeletionController extends Controller
{
    public function show(): Response
    {
        return $this->page('form');
    }

    public function store(Request $request, CredentialChecker $credentials, AccountDeletionService $deletions): Response
    {
        $validator = Validator::make($request->only(['email', 'password']), [
            'email' => ['bail', 'required', 'string', 'max:254', 'email:rfc'],
            'password' => ['bail', 'required', 'string', 'max:128'],
        ]);

        if ($validator->fails()) {
            return $this->page('invalid', 422);
        }

        $email = Str::lower(trim($request->string('email')->value()));
        $user = User::query()->where('email', $email)->first();

        if (! $credentials->check($user, $request->string('password')->value()) || $user === null) {
            return $this->page('invalid', 422);
        }

        try {
            $deletion = $deletions->request($user, DeletionChannel::Web);
        } catch (ProblemException $refusal) {
            if ($refusal->problem !== ProblemCode::ShopHasOpenHooks) {
                throw $refusal;
            }

            return $this->page('merchant_blocked', 409);
        }

        return $this->page('done', 200, [
            'until' => $deletion->grace_until->setTimezone((string) config('app.timezone'))->format('d.m.Y H:i'),
        ]);
    }

    /**
     * @param  array<string, string>  $data
     */
    private function page(string $state, int $status = 200, array $data = []): Response
    {
        return response()->view('web.account-deletion', [
            'state' => $state,
            'graceDays' => AccountDeletionService::GRACE_DAYS,
            ...$data,
        ], $status);
    }
}
