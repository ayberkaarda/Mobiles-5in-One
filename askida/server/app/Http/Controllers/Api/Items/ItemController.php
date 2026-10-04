<?php

namespace App\Http\Controllers\Api\Items;

use App\Domain\Auth\Abilities\Ability;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Services\ShopMembership;
use App\Http\Controllers\Controller;
use App\Http\Requests\Shops\StoreItemRequest;
use App\Http\Requests\Shops\UpdateItemRequest;
use App\Http\Resources\ItemResource;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
    public function __construct(private readonly ShopMembership $membership) {}

    /**
     * GET shops/{id}/items: owner or staff of the shop. The matrix has no row for this
     * read yet, so it applies the same order as the policies: ability (403), then
     * membership (404 for a non-member).
     */
    public function index(Request $request, string $id): AnonymousResourceCollection
    {
        $user = $this->user($request);

        if (! $user->tokenCan(Ability::Merchant->value)) {
            throw ProblemException::make(ProblemCode::Forbidden, 403);
        }

        $shop = Shop::query()->findOrFail($id);

        if ($user->isDeactivated() || $this->membership->roleOf($user, $shop) === null) {
            throw ProblemException::make(ProblemCode::NotFound, 404);
        }

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

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }
}
