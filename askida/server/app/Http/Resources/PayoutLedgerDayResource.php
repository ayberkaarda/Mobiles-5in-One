<?php

namespace App\Http\Resources;

use App\Domain\Payouts\Data\LedgerDay;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One day of a shop's payout ledger: amounts in kuruş, the redemption count and the
 * provider settlement state. Aggregates only, no donor or recipient identifiers.
 *
 * @property LedgerDay $resource
 */
class PayoutLedgerDayResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'date' => $this->resource->date,
            'donated_minor' => $this->resource->donatedMinor,
            'commission_minor' => $this->resource->commissionMinor,
            'net_minor' => $this->resource->netMinor(),
            'redeemed_count' => $this->resource->redeemedCount,
            'settlement' => [
                'status' => $this->resource->settlementStatus,
                'amount_minor' => $this->resource->settlementAmountMinor,
            ],
        ];
    }
}
