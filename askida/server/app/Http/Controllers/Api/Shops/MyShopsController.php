<?php

namespace App\Http\Controllers\Api\Shops;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Services\ShopDirectory;
use App\Http\Controllers\Controller;
use App\Http\Resources\MyShopResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * GET me/shops: the shops the calling merchant owns or staffs, read from `shop_members`
 * on every request (matrix 3.1). Unverified shops are included with their state; sample
 * shops follow the directory's sample policy, so every listed slug also opens through
 * GET shops/{slug}. No pagination: an account belongs to a handful of shops at most.
 */
class MyShopsController extends Controller
{
    public function __construct(private readonly ShopDirectory $directory) {}

    public function __invoke(Request $request): JsonResponse
    {
        Gate::authorize('viewMine', Shop::class);

        /** @var User $user */
        $user = $request->user();

        $query = Shop::query()
            ->join('shop_members', 'shop_members.shop_id', '=', 'shops.id')
            ->where('shop_members.user_id', $user->getKey())
            ->select('shops.*')
            ->addSelect('shop_members.role as member_role')
            ->orderBy('shops.name')
            ->orderBy('shops.id');
        $this->directory->applySamplePolicy($query);

        $data = [];

        foreach ($query->get() as $shop) {
            $role = ShopMemberRole::from((string) $shop->getAttribute('member_role'));
            $data[] = (new MyShopResource($shop, $role))->resolve($request);
        }

        return new JsonResponse(['data' => $data]);
    }
}
