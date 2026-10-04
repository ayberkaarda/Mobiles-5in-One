<?php

namespace App\Http\Controllers\Api\Webhooks;

use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Exceptions\InvalidWebhookSignature;
use App\Domain\Payments\Exceptions\StaleWebhook;
use App\Domain\Payments\Jobs\ProcessPaymentEvent;
use App\Http\Controllers\Controller;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * POST /api/v1/webhooks/iyzico.
 *
 * 1. The raw body is read before any JSON decoding and verified by the gateway together
 *    with the headers. A bad signature and a stale timestamp get the same 401
 *    `auth.token_invalid` problem (no oracle telling which check failed) and leave no row.
 * 2. A verified delivery is recorded once in `payment_events`; the unique
 *    (provider, event_id) index decides, so a replay answers `duplicate` and dispatches
 *    nothing.
 * 3. A new delivery answers `accepted` at once and queues `ProcessPaymentEvent`, which
 *    re-reads the payment from the provider. The event body never changes money state.
 */
final class IyzicoWebhookController extends Controller
{
    public const PROVIDER = 'iyzico';

    public function __invoke(Request $request, PaymentGateway $gateway): JsonResponse
    {
        $rawBody = $request->getContent();

        try {
            $event = $gateway->verifyWebhook($rawBody, $request->headers->all());
        } catch (InvalidWebhookSignature|StaleWebhook) {
            throw ProblemException::make(ProblemCode::TokenInvalid, 401);
        }

        $id = (string) Str::uuid7();
        $now = CarbonImmutable::now()->format('Y-m-d H:i:s.uP');

        // ON CONFLICT DO NOTHING on the unique (provider, event_id) index: a concurrent or
        // replayed delivery inserts nothing, and no unique violation aborts a surrounding
        // transaction.
        $inserted = DB::table('payment_events')->insertOrIgnore([
            'id' => $id,
            'provider' => self::PROVIDER,
            'event_id' => $event->eventId,
            'payload_hash' => hash('sha256', $rawBody),
            'received_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        if ($inserted === 0) {
            return new JsonResponse(['status' => 'duplicate']);
        }

        ProcessPaymentEvent::dispatch($id, $event->providerToken);

        return new JsonResponse(['status' => 'accepted']);
    }
}
