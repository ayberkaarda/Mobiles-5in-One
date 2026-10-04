<?php

namespace App\Http\Requests\Shops;

/**
 * PATCH shops/{id}: any subset of the shop fields; `lat` and `lng` travel together.
 */
class UpdateShopRequest extends ShopFieldsRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return $this->fieldRules(partial: true);
    }
}
