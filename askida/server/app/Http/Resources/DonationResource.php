<?php

namespace App\Http\Resources;

use App\Domain\Donations\Models\Donation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A donation as its donor sees it. Never exposes the provider token, the provider
 * payment id, the conversation id or anything about who collected a unit; hook counts
 * are aggregates only.
 *
 * @mixin Donation
 */
class DonationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Donation $donation */
        $donation = $this->resource;

        return [
            'id' => $donation->id,
            'shop' => ['id' => $donation->shop_id, 'name' => $donation->shop?->name],
            'item' => ['id' => $donation->item_id, 'name' => $donation->item?->name],
            'qty' => $donation->qty,
            'amount_minor' => $donation->amount_minor,
            'commission_minor' => $donation->commission_minor,
            'net_minor' => $donation->amount_minor - $donation->commission_minor,
            'currency' => $donation->currency,
            'status' => $donation->status->value,
            'paid_at' => $donation->paid_at?->toIso8601String(),
            'created_at' => $donation->created_at?->toIso8601String(),
        ];
    }
}
