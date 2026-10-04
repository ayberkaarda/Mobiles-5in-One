<?php

namespace App\Http\Controllers\Api\Payouts;

use App\Domain\Payments\Services\CommissionCalculator;
use App\Domain\Payouts\Services\PayoutLedger;
use App\Http\Controllers\Controller;
use App\Http\Requests\Payouts\PayoutLedgerRequest;
use App\Http\Resources\PayoutLedgerDayResource;
use Illuminate\Http\JsonResponse;

/**
 * GET shops/{id}/payouts (owner only; authorization in the request). Per-day ledger
 * rows plus the commission rule, so the app can show the platform commission openly.
 */
class PayoutLedgerController extends Controller
{
    public const COMMISSION_TEXT_KEY = 'payouts.commission.transparent';

    public function __invoke(PayoutLedgerRequest $request, PayoutLedger $ledger, CommissionCalculator $commission): JsonResponse
    {
        $page = $ledger->page($request->shop(), $request->limit(), $request->cursor());

        return new JsonResponse([
            'data' => PayoutLedgerDayResource::collection($page['days'])->resolve($request),
            'meta' => [
                'currency' => 'TRY',
                'next_cursor' => $page['next_cursor'],
                'commission' => [
                    'rate_bps' => $commission->basisPoints(),
                    'text_key' => self::COMMISSION_TEXT_KEY,
                ],
            ],
        ]);
    }
}
