<?php

namespace App\Http\Controllers\Api\Hooks;

use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Hooks\Services\HookDay;
use App\Domain\Hooks\Services\HookReleaseService;
use App\Domain\Shops\Models\Shop;
use App\Http\Controllers\Controller;
use App\Http\Requests\Hooks\RedemptionListRequest;
use App\Http\Resources\HookRedemptionResource;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

/**
 * GET shops/{shop}/redemptions?day= (owner or staff). Lists the day's redemptions of
 * the shop, newest first, with the item name, the time and the redeemer's role only.
 */
class RedemptionListController extends Controller
{
    public function __invoke(RedemptionListRequest $request, Shop $shop): AnonymousResourceCollection
    {
        $day = $request->day();
        [$start, $end] = HookDay::bounds($day);

        $rows = DB::table('hooks')
            ->join('items', 'items.id', '=', 'hooks.item_id')
            ->leftJoin('shop_members', function ($join): void {
                $join->on('shop_members.shop_id', '=', 'hooks.shop_id')
                    ->on('shop_members.user_id', '=', 'hooks.redeemed_by_user_id');
            })
            ->where('hooks.shop_id', $shop->id)
            ->where('hooks.status', HookStatus::Redeemed->value)
            ->where('hooks.redeemed_at', '>=', HookReleaseService::stamp($start))
            ->where('hooks.redeemed_at', '<', HookReleaseService::stamp($end))
            ->orderByDesc('hooks.redeemed_at')
            ->get(['items.name as item_name', 'hooks.redeemed_at', 'shop_members.role as redeemer_role']);

        return HookRedemptionResource::collection($rows)->additional([
            'meta' => ['day' => $start->toDateString(), 'count' => $rows->count()],
        ]);
    }
}
