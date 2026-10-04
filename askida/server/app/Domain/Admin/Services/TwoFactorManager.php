<?php

namespace App\Domain\Admin\Services;

use App\Models\User;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Support\Facades\DB;
use SensitiveParameter;

/**
 * TOTP state of a panel user: setup, confirmation, login checks, recovery codes, reset.
 *
 * - The secret is stored encrypted (model cast) and is only decrypted here.
 * - An accepted TOTP step is written under a row lock, so the same code (or an older
 *   one) is refused afterwards, also when two requests race.
 * - Recovery codes are random, shown once, stored as application hashes and removed
 *   when used.
 */
final class TwoFactorManager
{
    public const METHOD_TOTP = 'totp';

    public const METHOD_RECOVERY_CODE = 'recovery_code';

    private const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    public function __construct(
        private readonly TotpService $totp,
        private readonly Hasher $hasher,
        private readonly int $recoveryCodeCount = 10,
    ) {}

    public function hasConfirmed(User $user): bool
    {
        return $user->two_factor_confirmed_at !== null && $user->two_factor_secret !== null;
    }

    /**
     * The secret the user is setting up. An unconfirmed secret is kept across page loads
     * so that a scanned code stays valid; a confirmed one is never handed out again.
     */
    public function pendingSecret(User $user): string
    {
        if ($this->hasConfirmed($user)) {
            throw new \LogicException('The user already confirmed a TOTP secret.');
        }

        if ($user->two_factor_secret === null) {
            $user->forceFill([
                'two_factor_secret' => $this->totp->generateSecret(),
                'two_factor_recovery_codes' => null,
                'two_factor_last_used_step' => null,
            ])->save();
        }

        return (string) $user->two_factor_secret;
    }

    public function provisioningUri(User $user): string
    {
        return $this->totp->provisioningUri(
            $this->pendingSecret($user),
            $user->email,
            (string) config('admin.two_factor.issuer', 'Askida'),
        );
    }

    /**
     * Confirms the pending secret with a current code. Returns the plain recovery codes
     * (to be shown once) or null when the code is wrong.
     *
     * @return list<string>|null
     */
    public function confirm(User $user, #[SensitiveParameter] string $code): ?array
    {
        return DB::transaction(function () use ($user, $code): ?array {
            $locked = $this->lock($user);

            if ($this->hasConfirmed($locked) || $locked->two_factor_secret === null) {
                return null;
            }

            $step = $this->totp->verify($locked->two_factor_secret, $code, $locked->two_factor_last_used_step);

            if ($step === null) {
                return null;
            }

            $codes = $this->newRecoveryCodes();

            $locked->forceFill([
                'two_factor_confirmed_at' => now(),
                'two_factor_last_used_step' => $step,
                'two_factor_recovery_codes' => array_map(fn (string $plain): string => $this->hasher->make($plain), $codes),
            ])->save();

            $user->setRawAttributes($locked->getAttributes(), true);

            return $codes;
        });
    }

    /**
     * The second login factor: a current TOTP code or, when allowed, an unused recovery
     * code. Sensitive panel actions ask for a fresh TOTP code only. Returns the method
     * that matched (METHOD_TOTP or METHOD_RECOVERY_CODE) or null.
     */
    public function verifyLogin(User $user, #[SensitiveParameter] string $code, bool $allowRecoveryCode = true): ?string
    {
        return DB::transaction(function () use ($user, $code, $allowRecoveryCode): ?string {
            $locked = $this->lock($user);

            if (! $this->hasConfirmed($locked)) {
                return null;
            }

            $step = $this->totp->verify((string) $locked->two_factor_secret, $code, $locked->two_factor_last_used_step);

            if ($step !== null) {
                $locked->forceFill(['two_factor_last_used_step' => $step])->save();
                $user->setRawAttributes($locked->getAttributes(), true);

                return self::METHOD_TOTP;
            }

            if ($allowRecoveryCode && $this->consumeRecoveryCode($locked, $user, $code)) {
                return self::METHOD_RECOVERY_CODE;
            }

            return null;
        });
    }

    /**
     * A fresh TOTP code for a sensitive action (role changes). Recovery codes do not count.
     */
    public function verifyFreshCode(User $user, #[SensitiveParameter] string $code): bool
    {
        return $this->verifyLogin($user, $code, false) !== null;
    }

    /**
     * Clears the secret, the recovery codes and the replay marker. The user has to set
     * up TOTP again before reaching any panel page.
     */
    public function reset(User $user): void
    {
        $user->forceFill([
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_last_used_step' => null,
        ])->save();
    }

    public function remainingRecoveryCodes(User $user): int
    {
        return count($user->two_factor_recovery_codes ?? []);
    }

    private function consumeRecoveryCode(User $locked, User $user, string $code): bool
    {
        $normalized = strtoupper(preg_replace('/[\s-]+/', '', $code) ?? '');

        if (preg_match('/\A['.self::RECOVERY_ALPHABET.']{10}\z/', $normalized) !== 1) {
            return false;
        }

        $candidate = substr($normalized, 0, 5).'-'.substr($normalized, 5);
        $hashes = $locked->two_factor_recovery_codes ?? [];

        foreach ($hashes as $index => $hash) {
            if ($this->hasher->check($candidate, $hash)) {
                unset($hashes[$index]);
                $locked->forceFill(['two_factor_recovery_codes' => array_values($hashes)])->save();
                $user->setRawAttributes($locked->getAttributes(), true);

                return true;
            }
        }

        return false;
    }

    /**
     * @return list<string>
     */
    private function newRecoveryCodes(): array
    {
        $codes = [];
        $max = strlen(self::RECOVERY_ALPHABET) - 1;

        while (count($codes) < $this->recoveryCodeCount) {
            $raw = '';

            for ($i = 0; $i < 10; $i++) {
                $raw .= self::RECOVERY_ALPHABET[random_int(0, $max)];
            }

            $formatted = substr($raw, 0, 5).'-'.substr($raw, 5);

            if (! in_array($formatted, $codes, true)) {
                $codes[] = $formatted;
            }
        }

        return $codes;
    }

    private function lock(User $user): User
    {
        /** @var User $locked */
        $locked = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

        return $locked;
    }
}
