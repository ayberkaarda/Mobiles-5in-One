<?php

namespace App\Domain\Shops\Exceptions;

use App\Domain\Shops\Models\ShopVerificationState;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;

/**
 * A verification state change that the workflow does not allow. Rendered as a 409
 * `conflict` problem when it reaches an HTTP response.
 */
final class IllegalVerificationTransition extends ProblemException
{
    public static function between(ShopVerificationState $from, ShopVerificationState $to): self
    {
        return self::make(ProblemCode::Conflict, 409, "A shop cannot move from {$from->value} to {$to->value}.");
    }
}
