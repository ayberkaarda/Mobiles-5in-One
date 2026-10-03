<?php

namespace App\Http\Requests\Auth;

class VerifyEmailRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normaliseEmail();
        $this->trimField('code');
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'email' => self::emailRules(),
            'code' => self::codeRules(),
        ];
    }

    /**
     * @return list<string>
     */
    public static function codeRules(): array
    {
        return ['bail', 'required', 'string', 'regex:/^[0-9]{6}$/'];
    }
}
