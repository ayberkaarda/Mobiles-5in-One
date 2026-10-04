<?php

namespace App\Http\Requests\Accounts;

use App\Domain\Anon\Models\DevicePlatform;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rule;

/**
 * PUT me/push-token: the device platform and its opaque push registration token.
 */
class UpdatePushTokenRequest extends ApiFormRequest
{
    public const MAX_TOKEN_LENGTH = 4096;

    protected function prepareForValidation(): void
    {
        $this->trimField('token');
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'platform' => ['bail', 'required', 'string', Rule::enum(DevicePlatform::class)],
            'token' => ['bail', 'required', 'string', 'min:1', 'max:'.self::MAX_TOKEN_LENGTH, 'regex:/^[\x21-\x7E]+$/'],
        ];
    }

    public function platform(): DevicePlatform
    {
        return DevicePlatform::from($this->string('platform')->value());
    }

    public function pushToken(): string
    {
        return $this->string('token')->value();
    }
}
