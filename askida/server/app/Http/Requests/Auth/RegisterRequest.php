<?php

namespace App\Http\Requests\Auth;

use App\Domain\Auth\Enums\UserKind;
use App\Domain\Auth\Passwords\PasswordPolicy;
use Illuminate\Validation\Rule;

class RegisterRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->normaliseEmail();
        $this->trimField('name');
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'email' => [...self::emailRules(), 'unique:users,email'],
            'password' => ['bail', 'required', ...PasswordPolicy::rules()],
            'name' => ['bail', 'required', 'string', 'min:1', 'max:100'],
            'kind' => ['bail', 'required', 'string', Rule::enum(UserKind::class)],
            'device_name' => self::deviceNameRules(),
            'platform' => self::platformRules(),
            'kvkk_text_version' => self::kvkkVersionRules(true),
        ];
    }

    public function kind(): UserKind
    {
        return UserKind::from($this->string('kind')->value());
    }
}
