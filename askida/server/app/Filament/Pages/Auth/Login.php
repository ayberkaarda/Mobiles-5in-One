<?php

namespace App\Filament\Pages\Auth;

use App\Domain\Admin\PanelAccess;
use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Models\User;
use DanHarrin\LivewireRateLimiting\Exceptions\TooManyRequestsException;
use Filament\Facades\Filament;
use Filament\Forms\Components\Component;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Form;
use Filament\Http\Responses\Auth\Contracts\LoginResponse;
use Filament\Pages\Auth\Login as BaseLogin;
use Illuminate\Auth\SessionGuard;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Support\Htmlable;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Two-step panel sign-in: password first, then a TOTP code (or one recovery code).
 *
 * - The password step never signs a user with a confirmed secret in: it only records,
 *   in the server-side session, which user owes a code and until when.
 * - A panel user without a confirmed secret is signed in after the password and sent
 *   to the setup page, the only page EnsureTwoFactor lets through.
 * - Failed codes are limited (`admin-totp`, per user and address) and logged by user id.
 * - Donor and merchant accounts are refused with the same message as a wrong password.
 *
 * `$awaitingCode` only switches the form; the pending user lives in the session, so a
 * client that flips it gains nothing.
 */
class Login extends BaseLogin
{
    public const LIMITER = 'admin-totp';

    public bool $awaitingCode = false;

    public function mount(): void
    {
        parent::mount();

        $this->awaitingCode = TwoFactorSession::pendingUserId(session()->driver()) !== null;
    }

    public function authenticate(): ?LoginResponse
    {
        return $this->awaitingCode ? $this->verifyCode() : $this->verifyPassword();
    }

    public function cancelCode(): void
    {
        TwoFactorSession::forget(session()->driver());
        $this->awaitingCode = false;
        $this->form->fill();
    }

    protected function verifyPassword(): ?LoginResponse
    {
        try {
            $this->rateLimit(5);
        } catch (TooManyRequestsException $exception) {
            $this->getRateLimitedNotification($exception)?->send();

            return null;
        }

        $data = $this->form->getState();
        $guard = Filament::auth();
        abort_unless($guard instanceof SessionGuard, 500);
        $provider = $guard->getProvider();
        $user = $provider->retrieveByCredentials(['email' => (string) ($data['email'] ?? '')]);

        if (! $user instanceof User
            || ! $provider->validateCredentials($user, ['password' => (string) ($data['password'] ?? '')])
            || ! PanelAccess::allows($user)) {
            $this->throwFailureValidationException();
        }

        $twoFactor = app(TwoFactorManager::class);

        if ($twoFactor->hasConfirmed($user)) {
            TwoFactorSession::startChallenge(session()->driver(), $user, (int) config('admin.two_factor.challenge_ttl_seconds', 300));
            $this->awaitingCode = true;
            $this->form->fill();

            return null;
        }

        Filament::auth()->login($user);
        session()->regenerate();
        AdminAudit::log('admin.login_setup_required', $user, $user);

        return app(LoginResponse::class);
    }

    protected function verifyCode(): ?LoginResponse
    {
        $userId = TwoFactorSession::pendingUserId(session()->driver());
        $user = $userId === null ? null : User::query()->find($userId);

        if (! $user instanceof User || ! PanelAccess::allows($user)) {
            $this->cancelCode();

            throw ValidationException::withMessages([
                'data.email' => 'Doğrulama süresi doldu. Lütfen yeniden giriş yapın.',
            ]);
        }

        $limit = self::limitFor($user);

        if (RateLimiter::tooManyAttempts($limit->key, $limit->maxAttempts)) {
            throw ValidationException::withMessages([
                'data.code' => 'Çok fazla hatalı deneme. '.RateLimiter::availableIn($limit->key).' saniye sonra yeniden deneyin.',
            ]);
        }

        $data = $this->form->getState();
        $method = app(TwoFactorManager::class)->verifyLogin($user, (string) ($data['code'] ?? ''));

        if ($method === null) {
            RateLimiter::hit($limit->key, $limit->decaySeconds);
            AdminAudit::log('admin.totp_failed', $user, $user);

            throw ValidationException::withMessages([
                'data.code' => 'Kod doğrulanamadı.',
            ]);
        }

        RateLimiter::clear($limit->key);

        Filament::auth()->login($user);
        session()->regenerate();
        TwoFactorSession::markPassed(session()->driver(), $user);
        AdminAudit::log('admin.login', $user, $user, ['method' => $method]);

        return app(LoginResponse::class);
    }

    /**
     * The `admin-totp` limit for this user from this address.
     */
    public static function limitFor(User $user): Limit
    {
        $resolver = RateLimiter::limiter(self::LIMITER);
        $limit = $resolver === null ? null : $resolver(request(), $user);

        return $limit instanceof Limit
            ? $limit
            : Limit::perMinute((int) config('admin.two_factor.attempts_per_minute', 5))->by($user->getKey().'|'.request()->ip());
    }

    /**
     * @return array<int | string, string | Form>
     */
    protected function getForms(): array
    {
        return [
            'form' => $this->form(
                $this->makeForm()
                    ->schema([
                        $this->getEmailFormComponent()->hidden(fn (): bool => $this->awaitingCode),
                        $this->getPasswordFormComponent()->hidden(fn (): bool => $this->awaitingCode),
                        $this->getCodeFormComponent()->visible(fn (): bool => $this->awaitingCode),
                    ])
                    ->statePath('data'),
            ),
        ];
    }

    protected function getCodeFormComponent(): Component
    {
        return TextInput::make('code')
            ->label('Doğrulama kodu')
            ->helperText('Doğrulayıcı uygulamadaki 6 haneli kodu veya bir kurtarma kodunu girin.')
            ->required()
            ->autocomplete('one-time-code')
            ->maxLength(16)
            ->autofocus();
    }

    public function getHeading(): string|Htmlable
    {
        return $this->awaitingCode ? 'İki adımlı doğrulama' : 'Yönetim paneline giriş';
    }
}
