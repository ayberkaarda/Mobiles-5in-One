<?php

namespace App\Http\Requests\Auth;

class ForgotPasswordRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normaliseEmail();
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'email' => self::emailRules(),
        ];
    }
}
