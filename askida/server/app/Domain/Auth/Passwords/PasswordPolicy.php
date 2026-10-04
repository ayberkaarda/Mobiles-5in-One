<?php

namespace App\Domain\Auth\Passwords;

/**
 * Password rules for sign-up and reset: the equivalent of
 * `Password::min(10)->uncompromised()` whose breach check fails open
 * (see BreachedPasswordChecker) and whose failures map to stable error codes
 * (`min`, `max`, `uncompromised`).
 */
final class PasswordPolicy
{
    public const MIN_LENGTH = 10;

    public const MAX_LENGTH = 128;

    /**
     * @return list<mixed>
     */
    public static function rules(): array
    {
        return [
            'string',
            'min:'.self::MIN_LENGTH,
            'max:'.self::MAX_LENGTH,
            new Uncompromised(app(BreachedPasswordChecker::class)),
        ];
    }
}
