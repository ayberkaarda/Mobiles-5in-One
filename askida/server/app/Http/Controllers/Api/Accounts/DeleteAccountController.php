<?php

namespace App\Http\Controllers\Api\Accounts;

use App\Domain\Accounts\Services\AccountDeletionService;
use App\Domain\Accounts\Services\Reauthenticator;
use App\Domain\Auth\Models\DeletionChannel;
use App\Http\Controllers\Controller;
use App\Http\Requests\Accounts\DeleteAccountRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;

/**
 * DELETE me: re-authenticates, then deactivates the account at once and schedules the
 * erasure of its personal data after the grace period.
 */
class DeleteAccountController extends Controller
{
    public function __invoke(
        DeleteAccountRequest $request,
        Reauthenticator $reauthenticator,
        AccountDeletionService $deletions,
    ): JsonResponse {
        /** @var User $user */
        $user = $request->user();

        $reauthenticator->confirm($user, $request->password(), $request->provider(), $request->idToken(), $request->nonce());

        $deletion = $deletions->request($user, DeletionChannel::App);

        return response()->json([
            'status' => $deletion->status->value,
            'grace_until' => $deletion->grace_until->toIso8601String(),
        ], 202);
    }
}
