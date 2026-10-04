<?php

namespace App\Http\Requests\Shops;

class UpdateItemRequest extends ItemFieldsRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return $this->fieldRules(partial: true);
    }
}
