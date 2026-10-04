<?php

namespace App\Domain\Admin\Exceptions;

use RuntimeException;

/**
 * Refuses a change that would leave no active admin with a confirmed TOTP secret.
 */
final class LastAdminProtected extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('At least one active admin with confirmed two-factor sign-in must remain.');
    }
}
