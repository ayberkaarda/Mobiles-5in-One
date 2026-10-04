<?php

namespace App\Http\Controllers\Api\Documents;

use App\Domain\Shops\Documents\DocumentRules;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Services\DocumentUploadService;
use App\Http\Controllers\Controller;
use App\Http\Requests\Shops\PresignDocumentRequest;
use App\Http\Resources\ShopDocumentResource;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * Verification document uploads by the shop owner (ShopDocumentPolicy::create).
 *
 * The daily presign quota is the named limiter `document-presign`. It is applied here,
 * after authorization, so a caller who is not the owner cannot use up a shop's quota.
 */
class DocumentController extends Controller
{
    public function __construct(private readonly DocumentUploadService $uploads) {}

    public function presign(PresignDocumentRequest $request, string $id): JsonResponse
    {
        $shop = Shop::query()->findOrFail($id);

        Gate::authorize('create', [ShopDocument::class, $shop]);

        $this->consumePresignQuota($request);

        $upload = $this->uploads->presign($shop, $request->kind(), $request->mime(), $request->size());

        return new JsonResponse([
            'data' => [
                'document' => (new ShopDocumentResource($upload['document']))->resolve($request),
                'upload' => [
                    'method' => 'PUT',
                    'url' => $upload['url'],
                    'headers' => $upload['headers'],
                    'expires_at' => $upload['expires_at']->toIso8601String(),
                ],
            ],
        ], Response::HTTP_CREATED);
    }

    public function confirm(Request $request, string $id, string $documentId): ShopDocumentResource
    {
        $shop = Shop::query()->findOrFail($id);

        Gate::authorize('confirm', [ShopDocument::class, $shop]);

        $document = ShopDocument::query()
            ->whereKey($documentId)
            ->where('shop_id', $shop->getKey())
            ->firstOrFail();

        return new ShopDocumentResource($this->uploads->confirm($shop, $document));
    }

    private function consumePresignQuota(Request $request): void
    {
        $limiter = RateLimiter::limiter(DocumentRules::PRESIGN_LIMITER);

        if ($limiter === null) {
            throw ProblemException::make(ProblemCode::ServerError, 500);
        }

        /** @var list<Limit> $limits */
        $limits = Arr::wrap($limiter($request));

        foreach ($limits as $limit) {
            $key = DocumentRules::PRESIGN_LIMITER.':'.$limit->key;

            if (RateLimiter::tooManyAttempts($key, $limit->maxAttempts)) {
                throw ProblemException::make(ProblemCode::RateLimited, 429, headers: [
                    'Retry-After' => (string) RateLimiter::availableIn($key),
                ]);
            }
        }

        foreach ($limits as $limit) {
            RateLimiter::hit(DocumentRules::PRESIGN_LIMITER.':'.$limit->key, $limit->decaySeconds);
        }
    }
}
