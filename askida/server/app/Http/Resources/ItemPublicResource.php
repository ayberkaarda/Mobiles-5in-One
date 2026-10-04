<?php

namespace App\Http\Resources;

use App\Domain\Items\Models\Item;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Item inside a public shop detail: price and the count of AVAILABLE units only.
 *
 * @mixin Item
 */
class ItemPublicResource extends JsonResource
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
            'name' => $item->name,
            'category' => $item->category->value,
            'category_label' => $item->category->label(),
            'price_minor' => $item->price_minor,
            'currency' => $item->currency,
            'available_count' => (int) $item->getAttribute('available_count'),
        ];
    }
}
