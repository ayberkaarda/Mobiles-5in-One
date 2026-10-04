<?php

namespace App\Http\Requests\Auth;

use App\Domain\Auth\Passwords\PasswordPolicy;

class ResetPasswordRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normaliseEmail();
        $this->trimField('code');
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'email' => self::emailRules(),
            'code' => VerifyEmailRequest::codeRules(),
            'password' => ['bail', 'required', ...PasswordPolicy::rules()],
        ];
    }
}
