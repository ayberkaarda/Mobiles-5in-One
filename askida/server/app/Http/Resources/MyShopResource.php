<?php

namespace App\Http\Resources;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One shop of the calling merchant with the caller's role in it: enough to pick a shop
 * and open its screens. Contact, tax and bank data stay on GET shops/{slug} (owner view).
 *
 * @mixin Shop
 */
class MyShopResource extends JsonResource
{
    public function __construct(Shop $shop, private readonly ShopMemberRole $role)
    {
        parent::__construct($shop);
    }

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
            'il' => $shop->il,
            'ilce' => $shop->ilce,
            'verification_state' => $shop->verification_state->value,
            'role' => $this->role->value,
        ];
    }
}
