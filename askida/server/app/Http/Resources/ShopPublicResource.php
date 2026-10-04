<?php

namespace App\Http\Resources;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shop as donors and recipients see it. Never carries the owner, phone, tax number,
 * IBAN, provider keys or verification internals; availability is a count only.
 *
 * @mixin Shop
 */
class ShopPublicResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Shop $shop */
        $shop = $this->resource;
        $distance = $shop->getAttribute('distance_m');
        $available = $shop->getAttribute('available_count');

        return [
            'id' => $shop->id,
            'slug' => $shop->slug,
            'name' => $shop->name,
            'type' => $shop->type,
            'type_label' => ShopType::tryFrom($shop->type)?->label(),
            'address' => $shop->address,
            'il' => $shop->il,
            'ilce' => $shop->ilce,
            'location' => ['lat' => $shop->location->latitude, 'lng' => $shop->location->longitude],
            'distance_m' => $this->when($distance !== null, static fn (): int => (int) round((float) $distance)),
            'available_count' => $this->when($available !== null, static fn (): int => (int) $available),
            'is_sample' => $shop->is_sample,
        ];
    }
}
