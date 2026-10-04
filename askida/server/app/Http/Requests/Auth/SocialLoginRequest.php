<?php

namespace App\Http\Requests\Auth;

use App\Domain\Auth\Enums\UserKind;
use Illuminate\Validation\Rule;

/**
 * Sign in with Apple or Google. `name`, `kind` and `kvkk_text_version` are only used
 * when the sign-in creates the account; `kind` and `kvkk_text_version` are then required.
 */
class SocialLoginRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->trimField('name');
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'id_token' => ['bail', 'required', 'string', 'max:8192'],
            'nonce' => ['bail', 'required', 'string', 'min:16', 'max:255'],
            'device_name' => self::deviceNameRules(),
            'platform' => self::platformRules(),
            'name' => ['bail', 'nullable', 'string', 'max:100'],
            'kind' => ['bail', 'nullable', 'string', Rule::enum(UserKind::class)],
            'kvkk_text_version' => self::kvkkVersionRules(false),
        ];
    }

    public function kind(): ?UserKind
    {
        return $this->filled('kind') ? UserKind::from($this->string('kind')->value()) : null;
    }
}
