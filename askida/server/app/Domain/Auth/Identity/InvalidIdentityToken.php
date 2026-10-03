<?php

namespace App\Domain\Auth\Identity;

use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;

/**
 * Rejected identity token. The reason stays in the exception message for tests and
 * diagnostics; the response body only carries the generic `auth.token_invalid` problem.
 */
final class InvalidIdentityToken extends ProblemException
{
    public static function because(string $reason): self
    {
        return self::make(ProblemCode::TokenInvalid, 401, $reason);
    }
}
