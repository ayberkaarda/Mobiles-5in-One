<?php

namespace App\Http\Requests\Shops;

use App\Domain\Items\Models\ItemCategory;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rule;

/**
 * Shared rules of POST shops/{id}/items and PATCH shops/{id}/items/{itemId}. Prices are
 * integer kuruş; the currency and the shop are never client-writable.
 */
abstract class ItemFieldsRequest extends ApiFormRequest
{
    public const MIN_PRICE = 100;

    public const MAX_PRICE = 1_000_000;

    public const MAX_DAILY_CAP = 1000;

    private const PROHIBITED = ['id', 'shop_id', 'currency'];

    protected function prepareForValidation(): void
    {
        $this->trimField('name');
    }

    /**
     * @return array<string, list<mixed>>
     */
    protected function fieldRules(bool $partial): array
    {
        $presence = $partial ? ['bail', 'sometimes', 'required'] : ['bail', 'required'];

        $rules = [
            'name' => [...$presence, 'string', 'min:1', 'max:120'],
            'category' => [...$presence, 'string', Rule::enum(ItemCategory::class)],
            'price_minor' => [...$presence, 'integer', 'min:'.self::MIN_PRICE, 'max:'.self::MAX_PRICE],
            'daily_cap' => [...$presence, 'integer', 'min:1', 'max:'.self::MAX_DAILY_CAP],
            'active' => ['bail', 'sometimes', 'required', 'boolean'],
        ];

        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }
}
