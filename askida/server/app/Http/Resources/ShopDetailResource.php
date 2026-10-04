<?php

namespace App\Http\Resources;

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;

/**
 * GET shops/{slug}: the public shop shape plus its active items with AVAILABLE counts.
 *
 * @mixin Shop
 */
class ShopDetailResource extends ShopPublicResource
{
    /**
     * @param  Collection<int, Item>  $items
     */
    public function __construct(Shop $shop, private readonly Collection $items)
    {
        parent::__construct($shop);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $available = 0;

        foreach ($this->items as $item) {
            $available += (int) $item->getAttribute('available_count');
        }

        return [
            ...parent::toArray($request),
            'available_count' => $available,
            'items' => ItemPublicResource::collection($this->items)->resolve($request),
        ];
    }
}
