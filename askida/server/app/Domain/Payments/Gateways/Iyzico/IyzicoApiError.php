<?php

namespace App\Domain\Payments\Gateways\Iyzico;

use RuntimeException;

/**
 * The provider answered `status: failure` to a well-formed request. Carries only the
 * provider's error code (never its message, which may echo request data). Internal to
 * the gateway: callers see GatewayUnavailable or a result object.
 */
final class IyzicoApiError extends RuntimeException
{
    public function __construct(
        public readonly string $providerErrorCode,
    ) {
        parent::__construct('The payment provider rejected the request.');
    }
}
