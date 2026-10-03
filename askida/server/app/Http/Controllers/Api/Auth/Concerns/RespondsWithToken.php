<?php

namespace App\Http\Controllers\Api\Auth\Concerns;

use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Laravel\Sanctum\NewAccessToken;

trait RespondsWithToken
{
    protected function tokenResponse(User $user, NewAccessToken $token, int $status = 200): JsonResponse
    {
        return new JsonResponse([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $token->accessToken->expires_at?->toIso8601String(),
            'abilities' => array_values($token->accessToken->abilities ?? []),
            'user' => (new UserResource($user))->resolve(),
        ], $status);
    }
}
