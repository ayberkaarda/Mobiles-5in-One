<?php

namespace App\Http\Controllers\Api\Items;

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Http\Controllers\Controller;
use App\Http\Requests\Shops\StoreItemRequest;
use App\Http\Requests\Shops\UpdateItemRequest;
use App\Http\Resources\ItemResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * A shop's catalog. The owner writes (ItemPolicy); owner and staff read the full list.
 * A price change only touches the item row: donations keep their own `amount_minor`
 * and hooks carry no price, so existing units are never altered.
 */
class ItemController extends Controller
{
    /**
     * GET shops/{id}/items: owner or staff of the shop (ItemPolicy::viewAny), inactive
     * items included.
     */
    public function index(string $id): AnonymousResourceCollection
    {
        $shop = Shop::query()->findOrFail($id);

        Gate::authorize('viewAny', [Item::class, $shop]);

        return ItemResource::collection($shop->items()->orderBy('name')->orderBy('id')->get());
    }

    public function store(StoreItemRequest $request, string $id): JsonResponse
    {
        $shop = Shop::query()->findOrFail($id);

        Gate::authorize('create', [Item::class, $shop]);

        /** @var array<string, mixed> $data */
        $data = $request->validated();
        $item = new Item($data);
        $item->forceFill(['shop_id' => $shop->id, 'currency' => 'TRY'])->save();

        return (new ItemResource($item->refresh()))->response()->setStatusCode(Response::HTTP_CREATED);
    }

    public function update(UpdateItemRequest $request, string $id, string $itemId): ItemResource
    {
        $shop = Shop::query()->findOrFail($id);
        $item = Item::query()->findOrFail($itemId);

        Gate::authorize('update', [$item, $shop]);

        $item->fill($request->validated())->save();

        return new ItemResource($item->refresh());
    }
}
