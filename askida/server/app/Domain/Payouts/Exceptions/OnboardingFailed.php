<?php

namespace App\Domain\Payouts\Exceptions;

use RuntimeException;

/**
 * An onboarding attempt failed. The message names the shop id and the class of the
 * underlying failure only; the original exception is deliberately NOT chained, because a
 * transport error can quote the request (tax number, IBAN) and this exception ends up in
 * logs and in the failed-job record.
 */
final class OnboardingFailed extends RuntimeException
{
    public static function forShop(string $shopId, string $cause): self
    {
        return new self(sprintf('Sub-merchant onboarding failed for shop %s (%s).', $shopId, $cause));
    }
}
