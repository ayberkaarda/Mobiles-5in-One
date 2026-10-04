<?php

namespace App\Domain\Payouts\Data;

/**
 * One Europe/Istanbul calendar day of a shop's payout ledger. Amounts in kuruş.
 *
 * - donated / commission: paid donations of the shop by `paid_at`, with the commission
 *   stored on each donation at checkout; net = donated - commission;
 * - redeemed: REDEEMED hooks of the shop by `redeemed_at`;
 * - settlement: the provider payouts whose settlement day (`period`) is this day:
 *   `held` if any is held, else `failed` if any failed, else `pending` if any is pending,
 *   else `settled`; `none` when there is no payout that day.
 */
final readonly class LedgerDay
{
    public function __construct(
        public string $date,
        public int $donatedMinor,
        public int $commissionMinor,
        public int $redeemedCount,
        public string $settlementStatus,
        public ?int $settlementAmountMinor,
    ) {}

    public function netMinor(): int
    {
        return $this->donatedMinor - $this->commissionMinor;
    }
}
