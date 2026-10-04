<?php

namespace App\Http\Requests\Shops;

/**
 * POST shops: every field is required, `listed_on_web` is the merchant's explicit
 * consent (true or false) to appear in the public web directory.
 */
class StoreShopRequest extends ShopFieldsRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return $this->fieldRules(partial: false);
    }
}
