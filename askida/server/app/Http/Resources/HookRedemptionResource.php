<?php

namespace App\Http\Resources;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of a shop's redemption list (rule AN-2): item name, redemption time and the
 * role (owner or staff) of the member who redeemed it. No anon id, code, hash,
 * reservation time or device data.
 *
 * @property object{item_name: string, redeemed_at: string, redeemer_role: string|null} $resource
 */
class HookRedemptionResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'item' => ['name' => $this->resource->item_name],
            'redeemed_at' => CarbonImmutable::parse($this->resource->redeemed_at)->toIso8601String(),
            'redeemed_by_role' => $this->resource->redeemer_role,
        ];
    }
}
