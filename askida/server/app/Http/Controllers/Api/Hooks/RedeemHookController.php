<?php

namespace App\Http\Controllers\Api\Hooks;

use App\Domain\Hooks\Services\HookRedemptionService;
use App\Domain\Shops\Models\Shop;
use App\Http\Controllers\Controller;
use App\Http\Requests\Hooks\RedeemHookRequest;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;

/**
 * POST shops/{shop}/redeem (merchant token, owner or staff; limiter `redeem`).
 * Authorized by the form request (`redeem` on Hook for the shop) before validation.
 * The answer names the item only: "1 ekmek verildi".
 */
class RedeemHookController extends Controller
{
    public function __invoke(RedeemHookRequest $request, Shop $shop, HookRedemptionService $redemptions): JsonResponse
    {
        $merchant = $request->user();

        if (! $merchant instanceof User) {
            throw ProblemException::make(ProblemCode::Forbidden, 403);
        }

        $redeemed = $redemptions->redeem($shop, $merchant, $request->code());

        return new JsonResponse([
            'message' => '1 '.self::lowerTurkish($redeemed->itemName).' verildi',
            'item' => ['name' => $redeemed->itemName],
            'redeemed_at' => $redeemed->redeemedAt->toIso8601String(),
        ]);
    }

    private static function lowerTurkish(string $text): string
    {
        return mb_strtolower(strtr($text, ['I' => 'ı', 'İ' => 'i']), 'UTF-8');
    }
}
