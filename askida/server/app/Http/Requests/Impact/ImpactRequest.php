<?php

namespace App\Http\Requests\Impact;

use App\Http\Requests\Auth\ApiFormRequest;

/**
 * GET impact?il=&ilce=: optional province and district names as stored on shops.
 */
class ImpactRequest extends ApiFormRequest
{
    private const PLACE = '/^[\pL\pM][\pL\pM .\'-]*$/u';

    protected function prepareForValidation(): void
    {
        $this->trimField('il');
        $this->trimField('ilce');
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'il' => ['bail', 'required_with:ilce', 'nullable', 'string', 'max:64', 'regex:'.self::PLACE],
            'ilce' => ['bail', 'nullable', 'string', 'max:64', 'regex:'.self::PLACE],
        ];
    }

    public function il(): ?string
    {
        return $this->filled('il') ? $this->string('il')->value() : null;
    }

    public function ilce(): ?string
    {
        return $this->filled('ilce') ? $this->string('ilce')->value() : null;
    }
}
