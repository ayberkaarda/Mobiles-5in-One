<?php

namespace App\Domain\Payments\Services;

use InvalidArgumentException;

/**
 * Pure commission arithmetic in kuruş (TRY minor units).
 *
 * The platform books only its commission, rounded down so that the shop never receives
 * less than the exact share: commission = floor(amount * bps / 10000), net = amount - commission.
 */
final class CommissionCalculator
{
    public const BPS_DENOMINATOR = 10_000;

    public function __construct(
        private readonly int $basisPoints,
    ) {
        if ($basisPoints < 0 || $basisPoints > self::BPS_DENOMINATOR) {
            throw new InvalidArgumentException('Commission basis points must be between 0 and 10000.');
        }
    }

    public function basisPoints(): int
    {
        return $this->basisPoints;
    }

    public function commission(int $amountMinor): int
    {
        if ($amountMinor < 0) {
            throw new InvalidArgumentException('The amount cannot be negative.');
        }

        return intdiv($amountMinor * $this->basisPoints, self::BPS_DENOMINATOR);
    }

    public function net(int $amountMinor): int
    {
        return $amountMinor - $this->commission($amountMinor);
    }
}
