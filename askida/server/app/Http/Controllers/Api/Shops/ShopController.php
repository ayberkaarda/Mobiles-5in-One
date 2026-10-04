<?php

namespace App\Http\Controllers\Api\Shops;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Services\ShopDirectory;
use App\Domain\Shops\Services\ShopMembership;
use App\Domain\Shops\Services\ShopRegistrar;
use App\Http\Controllers\Controller;
use App\Http\Requests\Shops\ListShopsRequest;
use App\Http\Requests\Shops\StoreShopRequest;
use App\Http\Requests\Shops\UpdateShopRequest;
use App\Http\Resources\ShopDetailResource;
use App\Http\Resources\ShopOwnerResource;
use App\Http\Resources\ShopPublicResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shops: the verified directory (any API ability), registration and edits (owner).
 * Authorization follows docs/security/authorization-matrix.md section 3.2 through
 * ShopPolicy; a lookup comes first, so missing and foreign ids answer alike.
 */
class ShopController extends Controller
{
    public function __construct(
        private readonly ShopDirectory $directory,
        private readonly ShopRegistrar $registrar,
        private readonly ShopMembership $membership,
    ) {}

    public function index(ListShopsRequest $request): JsonResponse
    {
        Gate::authorize('viewAny', Shop::class);

        $page = $this->directory->near(
            $request->point(),
            $request->radius(),
            $request->onlyAvailable(),
            $request->limit(),
            $request->cursor(),
        );

        return new JsonResponse([
            'data' => ShopPublicResource::collection($page['shops'])->resolve($request),
            'meta' => [
                'radius' => $request->radius(),
                'next_cursor' => $page['next_cursor'],
            ],
        ]);
    }

    public function show(Request $request, string $slug): JsonResponse
    {
        $query = Shop::query()->where('slug', $slug);
        $this->directory->applySamplePolicy($query);
        $shop = $query->firstOrFail();

        Gate::authorize('view', $shop);

        $user = $request->user();

        if ($user instanceof User && $this->membership->isOwner($user, $shop)) {
            return (new ShopOwnerResource($shop))->response();
        }

        return (new ShopDetailResource($shop, $this->directory->itemsWithAvailability($shop)))->response();
    }

    public function store(StoreShopRequest $request): JsonResponse
    {
        Gate::authorize('create', Shop::class);

        $shop = $this->registrar->register($this->user($request), $request->validated());

        return (new ShopOwnerResource($shop->refresh()))->response()->setStatusCode(Response::HTTP_CREATED);
    }

    public function update(UpdateShopRequest $request, string $id): ShopOwnerResource
    {
        $shop = Shop::query()->findOrFail($id);

        Gate::authorize('update', $shop);

        $shop = $this->registrar->update($shop, $this->user($request), $request->validated());

        return new ShopOwnerResource($shop->refresh());
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }
}
