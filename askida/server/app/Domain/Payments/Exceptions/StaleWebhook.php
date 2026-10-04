<?php

namespace App\Domain\Payments\Exceptions;

use RuntimeException;

/**
 * The webhook is correctly signed but its timestamp is outside the accepted window
 * (replay protection, `payments.webhook_max_age_seconds`).
 */
final class StaleWebhook extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('The webhook timestamp is outside the accepted window.');
    }
}
