<?php

namespace App\Http\Controllers\Web;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Services\PayPageStore;
use App\Http\Controllers\Controller;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Vite;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Payment web pages for the in-app WebView (CSP profile `pay`, no analytics, noindex).
 *
 * - GET /pay/{token}: the checkout of an `initiated` donation that is still payable
 *   (checkout markup kept by PayPageStore, donation younger than the initiated window);
 *   everything else is 404.
 * - POST /pay/callback: the provider posts the token back. Only the token is read; any
 *   posted status, amount or id is ignored. The outcome comes from SettlesPayments, which
 *   re-reads the payment from the provider. CSRF verification is off for this route (a
 *   cross-site POST from the provider cannot carry our token); the protections are the
 *   unguessable token lookup, the server-side retrieve and the `pay-callback` limiter.
 *   The result page deep-links back to the app: askida://donation/<id>?status=<paid|failed|pending>.
 */
class PayController extends Controller
{
    public const TOKEN_PATTERN = '/^[A-Za-z0-9._-]{8,128}$/';

    public function show(string $token, PayPageStore $pages): Response
    {
        if (preg_match(self::TOKEN_PATTERN, $token) !== 1) {
            throw new NotFoundHttpException;
        }

        /** @var Donation|null $donation */
        $donation = Donation::query()->with(['shop:id,name', 'item:id,name'])->where('provider_token', $token)->first();
        $html = $pages->get($token);
        $window = (int) config('payments.caps.initiated_window_minutes', 30);

        if ($donation === null || $html === null || $donation->status !== DonationStatus::Initiated
            || $donation->created_at === null || $donation->created_at->lessThan(CarbonImmutable::now()->subMinutes($window))) {
            throw new NotFoundHttpException;
        }

        return response()->view('web.pay.checkout', [
            'shop' => (string) $donation->shop?->name,
            'item' => (string) $donation->item?->name,
            'qty' => $donation->qty,
            'amount' => self::lira($donation->amount_minor),
            'commission' => self::lira($donation->commission_minor),
            'net' => self::lira($donation->amount_minor - $donation->commission_minor),
            'checkout' => self::withNonce($html, Vite::cspNonce()),
        ])->header('Cache-Control', 'no-store');
    }

    public function callback(Request $request, SettlesPayments $settlement): Response
    {
        $token = $request->input('token');

        if (! is_string($token) || preg_match(self::TOKEN_PATTERN, $token) !== 1) {
            throw new NotFoundHttpException;
        }

        try {
            $outcome = $settlement->settle($token);
        } catch (GatewayUnavailable) {
            $outcome = SettlementOutcome::Pending;
        }

        if ($outcome === SettlementOutcome::UnknownToken) {
            throw new NotFoundHttpException;
        }

        $donationId = (string) Donation::query()->where('provider_token', $token)->value('id');

        $status = match ($outcome) {
            SettlementOutcome::Paid, SettlementOutcome::AlreadyPaid => 'paid',
            SettlementOutcome::Failed => 'failed',
            default => 'pending',
        };

        if ($outcome === SettlementOutcome::Paid || $outcome === SettlementOutcome::Failed) {
            app(PayPageStore::class)->forget($token);
        }

        return response()->view('web.pay.result', [
            'status' => $status,
            'deepLink' => 'askida://donation/'.rawurlencode($donationId).'?status='.$status,
        ])->header('Cache-Control', 'no-store');
    }

    /**
     * Gives every inline `<script>` of the provider markup the request's CSP nonce.
     */
    public static function withNonce(string $html, ?string $nonce): string
    {
        if ($nonce === null || $nonce === '') {
            return $html;
        }

        return (string) preg_replace('/<script\b(?![^>]*\bnonce=)/i', '$0 nonce="'.e($nonce).'"', $html);
    }

    private static function lira(int $minor): string
    {
        return number_format(intdiv($minor, 100), 0, ',', '.').','.str_pad((string) ($minor % 100), 2, '0', STR_PAD_LEFT).' ₺';
    }
}
