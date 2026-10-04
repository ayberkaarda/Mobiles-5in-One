<?php

namespace App\Http\Resources;

use App\Domain\Items\Models\Item;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Item as the shop's owner and staff see it in the catalog.
 *
 * @mixin Item
 */
class ItemResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Item $item */
        $item = $this->resource;

        return [
            'id' => $item->id,
            'shop_id' => $item->shop_id,
            'name' => $item->name,
            'category' => $item->category->value,
            'category_label' => $item->category->label(),
            'price_minor' => $item->price_minor,
            'currency' => $item->currency,
            'daily_cap' => $item->daily_cap,
            'active' => $item->active,
            'created_at' => $item->created_at?->toIso8601String(),
            'updated_at' => $item->updated_at?->toIso8601String(),
        ];
    }
}
