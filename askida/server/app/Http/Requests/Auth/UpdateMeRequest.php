<?php

namespace App\Http\Requests\Auth;

/**
 * PATCH me: only `name` is writable in Phase 1. Account kind, email, credentials,
 * provider subjects and verification state are rejected with the `prohibited` code.
 */
class UpdateMeRequest extends ApiFormRequest
{
    private const PROHIBITED = [
        'kind', 'email', 'password', 'apple_sub', 'google_sub', 'email_verified_at', 'deactivated_at', 'id',
    ];

    protected function prepareForValidation(): void
    {
        $this->trimField('name');
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        $rules = [
            'name' => ['bail', 'sometimes', 'required', 'string', 'min:1', 'max:100'],
        ];

        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }
}
