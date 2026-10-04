<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Public shape of an account. Never exposes the password hash or provider subjects.
 *
 * @mixin User
 */
class UserResource extends JsonResource
{
    /**
     * @return array{id: string, email: string, name: string, kind: string, email_verified: bool}
     */
    public function toArray(Request $request): array
    {
        /** @var User $user */
        $user = $this->resource;

        return [
            'id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'kind' => $user->kind->value,
            'email_verified' => $user->hasVerifiedEmail(),
        ];
    }
}
