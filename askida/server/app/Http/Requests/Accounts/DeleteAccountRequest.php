<?php

namespace App\Http\Requests\Accounts;

use App\Domain\Auth\Enums\IdentityProvider;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rule;

/**
 * DELETE me: re-authentication proof. Either `password`, or `provider` + `id_token` +
 * `nonce` for an Apple or Google account. Which one is required depends on the account
 * and is decided by the Reauthenticator.
 */
class DeleteAccountRequest extends ApiFormRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'password' => ['bail', 'nullable', 'string', 'max:128'],
            'provider' => ['bail', 'nullable', 'required_with:id_token', 'string', Rule::enum(IdentityProvider::class)],
            'id_token' => ['bail', 'nullable', 'string', 'max:8192'],
            'nonce' => ['bail', 'nullable', 'required_with:id_token', 'string', 'min:16', 'max:255'],
        ];
    }

    public function password(): ?string
    {
        return $this->filled('password') ? $this->string('password')->value() : null;
    }

    public function provider(): ?IdentityProvider
    {
        return $this->filled('provider') ? IdentityProvider::from($this->string('provider')->value()) : null;
    }

    public function idToken(): ?string
    {
        return $this->filled('id_token') ? $this->string('id_token')->value() : null;
    }

    public function nonce(): ?string
    {
        return $this->filled('nonce') ? $this->string('nonce')->value() : null;
    }
}
