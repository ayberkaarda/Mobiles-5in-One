<?php

namespace App\Http\Controllers\Api\Donations;

use App\Domain\Donations\Models\Donation;
use App\Domain\Payments\Services\DonationCheckout;
use App\Http\Controllers\Controller;
use App\Http\Requests\Donations\ListDonationsRequest;
use App\Http\Requests\Donations\StoreDonationRequest;
use App\Http\Resources\DonationResource;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Donations of the calling donor (DonationPolicy, matrix section 3.3).
 *
 * - POST donations: 201 `{donation_id, checkout_url}`; limiter `donations-create`;
 * - GET donations: own donations, newest first, cursor paginated;
 * - GET donations/{id}: own donation; another donor's donation answers 404 like a missing id.
 */
class DonationController extends Controller
{
    public function store(StoreDonationRequest $request, DonationCheckout $checkout): JsonResponse
    {
        $started = $checkout->start(
            self::donor($request),
            $request->string('shop_id')->value(),
            $request->string('item_id')->value(),
            $request->integer('qty'),
        );

        return response()->json([
            'donation_id' => $started['donation']->id,
            'checkout_url' => $started['checkout_url'],
        ], 201);
    }

    public function index(ListDonationsRequest $request): JsonResponse
    {
        $page = Donation::query()
            ->with(['shop:id,name', 'item:id,name'])
            ->where('donor_id', self::donor($request)->getKey())
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->limit(), ['*'], 'cursor');

        return response()->json([
            'data' => DonationResource::collection($page->items())->resolve($request),
            'meta' => ['next_cursor' => $page->nextCursor()?->encode()],
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        /** @var Donation|null $donation */
        $donation = Donation::query()->with(['shop:id,name', 'item:id,name'])->find($id);

        if ($donation === null) {
            Gate::authorize('viewAny', Donation::class);

            throw ProblemException::make(ProblemCode::NotFound, 404);
        }

        Gate::authorize('view', $donation);

        return response()->json(['data' => (new DonationResource($donation))->resolve($request)]);
    }

    private static function donor(Request $request): User
    {
        $user = $request->user();

        if (! $user instanceof User) {
            throw ProblemException::make(ProblemCode::Forbidden, 403);
        }

        return $user;
    }
}
