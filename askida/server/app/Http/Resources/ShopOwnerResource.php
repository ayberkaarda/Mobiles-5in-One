<?php

namespace App\Http\Resources;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopType;
use App\Domain\Shops\Support\TurkishIban;
use App\Domain\Shops\Support\TurkishTaxNumber;
use App\Domain\Web\Directory\OpeningHours;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shop as its owner sees it: contact data and verification state, the tax number and
 * IBAN masked to their last four digits. No owner id and no provider keys.
 *
 * @mixin Shop
 */
class ShopOwnerResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Shop $shop */
        $shop = $this->resource;

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
            'phone' => $shop->phone,
            'tax_number_masked' => TurkishTaxNumber::mask($shop->tax_number_enc),
            'iban_masked' => TurkishIban::mask($shop->iban_enc),
            'verification_state' => $shop->verification_state->value,
            'verified_at' => $shop->verified_at?->toIso8601String(),
            'listed_on_web' => $shop->listed_on_web,
            'opening_hours' => OpeningHours::normalize($shop->opening_hours),
            'created_at' => $shop->created_at?->toIso8601String(),
            'updated_at' => $shop->updated_at?->toIso8601String(),
        ];
    }
}
