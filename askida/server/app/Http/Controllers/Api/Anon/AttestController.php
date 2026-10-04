<?php

namespace App\Http\Controllers\Api\Anon;

use App\Domain\Anon\Attestation\AttestationFailed;
use App\Domain\Anon\Attestation\AttestationUnavailable;
use App\Domain\Anon\Services\AnonAttestationService;
use App\Domain\Anon\Services\AnonDeviceBanned;
use App\Domain\Auth\Abilities\Ability;
use App\Http\Controllers\Controller;
use App\Http\Requests\Anon\AttestRequest;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;

/**
 * POST anon/attest (guest; limiter `anon-attest`). Returns the anon session token; the
 * anon id itself is never sent to the client.
 */
class AttestController extends Controller
{
    public function __invoke(AttestRequest $request, AnonAttestationService $attestation): JsonResponse
    {
        $platform = $request->platform();

        try {
            $session = $attestation->attest($platform, $request->string('token')->value(), $request->string('device_nonce')->value());
        } catch (AnonDeviceBanned) {
            throw ProblemException::make(ProblemCode::Forbidden, 403);
        } catch (AttestationFailed $e) {
            Log::notice('anon.attestation_rejected', ['platform' => $platform->value, 'reason' => $e->getMessage()]);

            throw ProblemException::make(ProblemCode::TokenInvalid, 401);
        } catch (AttestationUnavailable $e) {
            Log::warning('anon.attestation_unavailable', ['platform' => $platform->value, 'reason' => $e->getMessage()]);

            throw ProblemException::make(ProblemCode::ServiceUnavailable, 503);
        }

        return new JsonResponse([
            'token' => $session->token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $session->token->accessToken->expires_at?->toIso8601String(),
            'abilities' => [Ability::Anon->value],
        ]);
    }
}
