<?php

namespace App\Filament\Pages;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Admin\Services\QrCodeRenderer;
use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Admin\Support\TwoFactorSession;
use App\Filament\Pages\Auth\Login;
use App\Models\User;
use Filament\Facades\Filament;
use Filament\Pages\Page;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Forced TOTP setup. A panel user without a confirmed secret is sent here from every
 * other panel route (EnsureTwoFactor). The page shows a QR code rendered on the server
 * and the secret for manual entry; a correct code confirms the secret, completes the
 * second factor for this session and shows the recovery codes once.
 */
class TwoFactorSetup extends Page
{
    protected static string $view = 'filament.pages.two-factor-setup';

    protected static ?string $slug = 'two-factor-setup';

    protected static bool $shouldRegisterNavigation = false;

    protected static ?string $title = 'İki adımlı doğrulama kurulumu';

    public string $code = '';

    /**
     * Filled once, right after confirmation, so the user can copy the codes. The page is
     * closed for this user on the next request.
     *
     * @var list<string>
     */
    public array $recoveryCodes = [];

    public static function canAccess(): bool
    {
        return Filament::auth()->user() instanceof User;
    }

    public function confirm(): void
    {
        $user = $this->user();
        $limit = Login::limitFor($user);

        if (RateLimiter::tooManyAttempts($limit->key, $limit->maxAttempts)) {
            throw ValidationException::withMessages([
                'code' => 'Çok fazla hatalı deneme. '.RateLimiter::availableIn($limit->key).' saniye sonra yeniden deneyin.',
            ]);
        }

        $codes = app(TwoFactorManager::class)->confirm($user, $this->code);
        $this->code = '';

        if ($codes === null) {
            RateLimiter::hit($limit->key, $limit->decaySeconds);
            AdminAudit::log('admin.totp_failed', $user, $user);

            throw ValidationException::withMessages(['code' => 'Kod doğrulanamadı.']);
        }

        RateLimiter::clear($limit->key);
        session()->regenerate();
        TwoFactorSession::markPassed(session()->driver(), $user);
        AdminAudit::log('admin.login', $user, $user, ['method' => 'totp_setup']);

        $this->recoveryCodes = $codes;
    }

    public function qrCodeDataUri(): string
    {
        return app(QrCodeRenderer::class)->dataUri(app(TwoFactorManager::class)->provisioningUri($this->user()));
    }

    /**
     * The secret in groups of four for typing into an authenticator app.
     */
    public function manualSecret(): string
    {
        return trim(chunk_split(app(TwoFactorManager::class)->pendingSecret($this->user()), 4, ' '));
    }

    public function isConfirmed(): bool
    {
        return $this->recoveryCodes !== [];
    }

    public function dashboardUrl(): string
    {
        return Filament::getUrl() ?? '/admin';
    }

    private function user(): User
    {
        $user = Filament::auth()->user();
        abort_unless($user instanceof User, 403);

        return $user;
    }
}
