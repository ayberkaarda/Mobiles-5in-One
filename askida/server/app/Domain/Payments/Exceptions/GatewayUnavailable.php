<?php

namespace App\Domain\Payments\Exceptions;

use RuntimeException;
use Throwable;

/**
 * The provider could not be reached or answered with a transport-level failure.
 * Never carries request payloads or credentials in the message.
 */
final class GatewayUnavailable extends RuntimeException
{
    public function __construct(string $message = 'The payment provider is unavailable.', ?Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
