<?php

namespace App\Http\Requests\Auth;

use App\Domain\Auth\Passwords\PasswordPolicy;

class LoginRequest extends ApiFormRequest
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
            'password' => ['bail', 'required', 'string', 'max:'.PasswordPolicy::MAX_LENGTH],
            'device_name' => self::deviceNameRules(),
            'platform' => self::platformRules(),
        ];
    }
}
