<?php

namespace App\Http\Requests\Shops;

use App\Domain\Shops\Models\ShopType;
use App\Domain\Shops\Support\TurkishIban;
use App\Domain\Shops\Support\TurkiyeBounds;
use App\Domain\Shops\Validation\IbanChecksum;
use App\Domain\Shops\Validation\TaxNumberChecksum;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rule;

/**
 * Shared field rules of POST shops and PATCH shops/{id}. Server-controlled columns are
 * refused with the `prohibited` code.
 */
abstract class ShopFieldsRequest extends ApiFormRequest
{
    private const PROHIBITED = [
        'id', 'owner_id', 'slug', 'verification_state', 'verified_at', 'is_sample', 'sub_merchant_key',
        'tax_number_enc', 'iban_enc', 'location',
    ];

    protected function prepareForValidation(): void
    {
        foreach (['name', 'address', 'il', 'ilce'] as $field) {
            $this->trimField($field);
        }

        $phone = $this->input('phone');

        if (is_string($phone)) {
            $digits = (string) preg_replace('/[\s().-]+/', '', $phone);

            // Accepted shapes: +90 dddddddddd, 90 dddddddddd, 0 dddddddddd, dddddddddd (d = digit).
            if (preg_match('/^(?:\+?90|0)?([2-589]\d{9})$/', $digits, $matches) === 1) {
                $digits = '+90'.$matches[1];
            }

            $this->merge(['phone' => $digits]);
        }

        $taxNumber = $this->input('tax_number');

        if (is_string($taxNumber)) {
            $this->merge(['tax_number' => (string) preg_replace('/\s+/', '', $taxNumber)]);
        }

        $iban = $this->input('iban');

        if (is_string($iban)) {
            $this->merge(['iban' => TurkishIban::normalise($iban)]);
        }
    }

    /**
     * @return array<string, list<mixed>>
     */
    protected function fieldRules(bool $partial): array
    {
        $presence = $partial ? ['bail', 'sometimes', 'required'] : ['bail', 'required'];

        $rules = [
            'name' => [...$presence, 'string', 'min:2', 'max:120'],
            'type' => [...$presence, 'string', Rule::enum(ShopType::class)],
            'address' => [...$presence, 'string', 'min:5', 'max:255'],
            'il' => [...$presence, 'string', 'min:2', 'max:64'],
            'ilce' => [...$presence, 'string', 'min:2', 'max:64'],
            'lat' => [
                ...($partial ? ['bail', 'required_with:lng'] : ['bail', 'required']),
                'numeric', 'between:'.TurkiyeBounds::MIN_LATITUDE.','.TurkiyeBounds::MAX_LATITUDE,
            ],
            'lng' => [
                ...($partial ? ['bail', 'required_with:lat'] : ['bail', 'required']),
                'numeric', 'between:'.TurkiyeBounds::MIN_LONGITUDE.','.TurkiyeBounds::MAX_LONGITUDE,
            ],
            'phone' => [...$presence, 'string', 'regex:/^\+90[2-589]\d{9}$/'],
            'tax_number' => [...$presence, 'string', 'digits:10', new TaxNumberChecksum],
            'iban' => [...$presence, 'string', 'size:26', new IbanChecksum],
            'listed_on_web' => [...$presence, 'boolean'],
        ];

        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }
}
