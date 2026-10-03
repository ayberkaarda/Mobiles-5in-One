<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\UpdateMeRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The token's own account. There is no user id in the path, so a token can only
 * ever read or change its own user.
 */
class MeController extends Controller
{
    public function show(Request $request): UserResource
    {
        return new UserResource($this->currentUser($request));
    }

    public function update(UpdateMeRequest $request): UserResource
    {
        $user = $this->currentUser($request);

        if ($request->has('name')) {
            $user->forceFill(['name' => $request->string('name')->value()])->save();
        }

        return new UserResource($user);
    }

    private function currentUser(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }
}
