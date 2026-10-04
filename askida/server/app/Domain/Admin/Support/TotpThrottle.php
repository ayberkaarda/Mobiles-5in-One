<?php

namespace App\Domain\Admin\Support;

use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Throttle for every TOTP and recovery-code check of the panel (login, setup, fresh-code
 * prompts). Two limits apply at once:
 * - per user and address (limiter `admin-totp`, per minute), the quick brake;
 * - per user from any address (limiter `admin-totp-account`): after
 *   `admin.two_factor.account_attempts` failures the account's code step is locked for
 *   `account_lockout_seconds`, so guesses spread over many addresses still run out.
 * A success clears the per-address counter only; the account counter decays on its own.
 */
final class TotpThrottle
{
    public const ACCOUNT_LIMITER = 'admin-totp-account';

    /**
     * @param  callable(): Limit  $addressLimit
     */
    public function __construct(private readonly User $user, private readonly mixed $addressLimit) {}

    /**
     * @throws ValidationException when either limit is exhausted
     */
    public function ensureAllowed(string $field): void
    {
        $address = $this->address();

        if (RateLimiter::tooManyAttempts($this->accountKey(), $this->accountAttempts())) {
            throw ValidationException::withMessages([
                $field => 'Bu hesap için çok fazla hatalı kod girildi. '.RateLimiter::availableIn($this->accountKey()).' saniye sonra yeniden deneyin.',
            ]);
        }

        if (RateLimiter::tooManyAttempts($address->key, $address->maxAttempts)) {
            throw ValidationException::withMessages([
                $field => 'Çok fazla hatalı deneme. '.RateLimiter::availableIn($address->key).' saniye sonra yeniden deneyin.',
            ]);
        }
    }

    public function failed(): void
    {
        $address = $this->address();

        RateLimiter::hit($address->key, $address->decaySeconds);
        RateLimiter::hit($this->accountKey(), $this->lockoutSeconds());
    }

    public function succeeded(): void
    {
        RateLimiter::clear($this->address()->key);
    }

    private function address(): Limit
    {
        return ($this->addressLimit)();
    }

    private function accountKey(): string
    {
        return self::ACCOUNT_LIMITER.':'.$this->user->getKey();
    }

    private function accountAttempts(): int
    {
        return (int) config('admin.two_factor.account_attempts', 10);
    }

    private function lockoutSeconds(): int
    {
        return (int) config('admin.two_factor.account_lockout_seconds', 900);
    }
}
