<?php

namespace App\Http\Controllers\Api\Accounts;

use App\Domain\Accounts\Services\PushTokenRegistry;
use App\Http\Controllers\Controller;
use App\Http\Requests\Accounts\UpdatePushTokenRequest;
use App\Models\User;
use Illuminate\Http\Response;

/**
 * PUT me/push-token: registers (or refreshes) a push token for the token's own user.
 * The answer is empty so the registration token never travels back.
 */
class PushTokenController extends Controller
{
    public function __invoke(UpdatePushTokenRequest $request, PushTokenRegistry $registry): Response
    {
        /** @var User $user */
        $user = $request->user();

        $registry->register($user, $request->platform(), $request->pushToken());

        return response()->noContent();
    }
}
