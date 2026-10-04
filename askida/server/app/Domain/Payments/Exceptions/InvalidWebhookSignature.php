<?php

namespace App\Domain\Payments\Exceptions;

use RuntimeException;

/**
 * The webhook signature is missing, malformed or does not match. The message never
 * carries the body, the headers or the expected signature.
 */
final class InvalidWebhookSignature extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('The webhook signature is invalid.');
    }
}
