<?php

namespace App\Http\Requests\Shops;

use App\Domain\Web\Directory\OpeningHoursFormat;

/**
 * PATCH shops/{id}: any subset of the shop fields; `lat` and `lng` travel together.
 * `opening_hours` (edit only) is `{mon..sun: {open: "HH:MM", close: "HH:MM"} | null}`;
 * null clears the hours, a day left out is closed.
 */
class UpdateShopRequest extends ShopFieldsRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            ...$this->fieldRules(partial: true),
            'opening_hours' => ['bail', 'sometimes', 'nullable', 'array', new OpeningHoursFormat],
        ];
    }
}
