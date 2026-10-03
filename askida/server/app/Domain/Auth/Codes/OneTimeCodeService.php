<?php

namespace App\Domain\Auth\Codes;

use App\Domain\Auth\Enums\OneTimeCodePurpose;
use App\Domain\Auth\Support\KeyedHash;
use App\Mail\EmailVerificationCodeMail;
use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Six-digit codes mailed for email verification and password reset.
 *
 * Only a keyed hash is stored (table password_reset_tokens, one row per user and
 * purpose). A code expires after auth.codes.ttl_minutes, is single use, and is
 * discarded after auth.codes.max_attempts wrong guesses. Issuing a new code
 * replaces the previous one.
 */
class OneTimeCodeService
{
    private const TABLE = 'password_reset_tokens';

    public function sendEmailVerification(User $user): void
    {
        $code = $this->issue($user, OneTimeCodePurpose::EmailVerification);

        Mail::to($user->email)->queue(new EmailVerificationCodeMail($user->name, $code));
    }

    public function sendPasswordReset(User $user): void
    {
        $code = $this->issue($user, OneTimeCodePurpose::PasswordReset);

        Mail::to($user->email)->queue(new PasswordResetCodeMail($user->name, $code));
    }

    public function issue(User $user, OneTimeCodePurpose $purpose): string
    {
        $code = str_pad((string) random_int(0, 999_999), 6, '0', STR_PAD_LEFT);
        $now = Carbon::now();

        DB::transaction(function () use ($user, $purpose, $code, $now): void {
            DB::table(self::TABLE)
                ->where('user_id', $user->id)
                ->where('purpose', $purpose->value)
                ->delete();

            DB::table(self::TABLE)->insert([
                'id' => (string) Str::uuid7(),
                'user_id' => $user->id,
                'purpose' => $purpose->value,
                'code_hash' => $this->hash($purpose, $code),
                'attempts' => 0,
                'expires_at' => $now->copy()->addMinutes($this->ttlMinutes())->toIso8601String(),
                'created_at' => $now->toIso8601String(),
            ]);
        });

        return $code;
    }

    /**
     * Checks and consumes a code. Returns true exactly once for a valid, unexpired code.
     */
    public function consume(User $user, OneTimeCodePurpose $purpose, string $code): bool
    {
        return DB::transaction(function () use ($user, $purpose, $code): bool {
            $row = DB::table(self::TABLE)
                ->where('user_id', $user->id)
                ->where('purpose', $purpose->value)
                ->lockForUpdate()
                ->first();

            if ($row === null) {
                return false;
            }

            $query = DB::table(self::TABLE)->where('id', $row->id);

            if (Carbon::parse((string) $row->expires_at)->isPast()) {
                $query->delete();

                return false;
            }

            if (! hash_equals((string) $row->code_hash, $this->hash($purpose, $code))) {
                if ((int) $row->attempts + 1 >= $this->maxAttempts()) {
                    $query->delete();
                } else {
                    $query->increment('attempts');
                }

                return false;
            }

            $query->delete();

            return true;
        });
    }

    private function hash(OneTimeCodePurpose $purpose, string $code): string
    {
        return KeyedHash::make('one-time-code:'.$purpose->value, $code);
    }

    private function ttlMinutes(): int
    {
        return (int) config('auth.codes.ttl_minutes', 60);
    }

    private function maxAttempts(): int
    {
        return (int) config('auth.codes.max_attempts', 5);
    }
}
