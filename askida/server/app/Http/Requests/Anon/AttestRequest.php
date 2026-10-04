<?php

namespace App\Http\Requests\Anon;

use App\Domain\Anon\Models\DevicePlatform;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rule;

/**
 * POST anon/attest. `device_nonce` is the per-install random value the app bound into
 * the attestation request (base64url, 16 to 128 characters).
 */
class AttestRequest extends ApiFormRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'platform' => ['bail', 'required', 'string', Rule::enum(DevicePlatform::class)],
            'token' => ['bail', 'required', 'string', 'min:1', 'max:8192'],
            'device_nonce' => ['bail', 'required', 'string', 'regex:/^[A-Za-z0-9_-]{16,128}$/'],
        ];
    }

    public function platform(): DevicePlatform
    {
        return DevicePlatform::from($this->string('platform')->value());
    }
}
