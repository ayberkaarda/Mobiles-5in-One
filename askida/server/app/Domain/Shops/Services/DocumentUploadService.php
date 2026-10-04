<?php

namespace App\Domain\Shops\Services;

use App\Domain\Shops\Documents\DocumentFailure;
use App\Domain\Shops\Documents\DocumentInspector;
use App\Domain\Shops\Documents\DocumentRules;
use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Documents\DocumentUploadKind;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Two-step document upload straight to the private disk.
 *
 * 1. presign: under a lock on the shop row, enforce at most three documents per shop,
 *    create a pending `shop_documents` row and return a 5-minute presigned PUT URL for
 *    one object key. S3 presigned PUT URLs cannot bind the body length or type, so
 *    both are enforced at confirmation against the stored bytes.
 * 2. confirm: read the uploaded object back and check size, magic bytes and PDF safety.
 *    On failure the object and the row are deleted. On success exactly the inspected
 *    bytes are written to the document key (which no presigned URL can reach), the
 *    upload object is deleted and `uploaded_at` is set.
 *
 * The client never receives a read URL; only DocumentUrlSigner creates one, for admins.
 */
final class DocumentUploadService
{
    /**
     * A pending row whose upload URL expired this long ago no longer counts towards the
     * per-shop limit and is cleaned up by the next presign.
     */
    private const STALE_GRACE_MINUTES = 1;

    public function __construct(
        private readonly DocumentStorage $storage,
        private readonly DocumentInspector $inspector,
    ) {}

    /**
     * @return array{document: ShopDocument, url: string, headers: array<string, string>, expires_at: CarbonImmutable}
     */
    public function presign(Shop $shop, DocumentUploadKind $kind, string $mime, int $size): array
    {
        return DB::transaction(function () use ($shop, $kind, $mime, $size): array {
            Shop::query()->whereKey($shop->getKey())->lockForUpdate()->firstOrFail();

            $this->discardStalePending($shop);

            if (ShopDocument::query()->where('shop_id', $shop->getKey())->count() >= DocumentRules::MAX_DOCUMENTS_PER_SHOP) {
                throw ProblemException::make(ProblemCode::Conflict, 409, 'The shop already has the maximum number of documents.');
            }

            $document = new ShopDocument(['kind' => $kind->storedKind()]);
            $id = (string) Str::uuid7();
            $document->forceFill([
                'id' => $id,
                'shop_id' => $shop->getKey(),
                'path' => DocumentStorage::uploadKey((string) $shop->getKey(), $id),
                'mime' => $mime,
                'size' => $size,
                'uploaded_at' => null,
            ])->save();

            $expiresAt = CarbonImmutable::now()->addMinutes(DocumentRules::URL_TTL_MINUTES);

            /** @var array{url: string, headers: array<array-key, mixed>} $upload */
            $upload = $this->storage->disk()->temporaryUploadUrl($document->path, $expiresAt, ['ContentType' => $mime]);

            $headers = ['Content-Type' => $mime];

            foreach ($upload['headers'] as $name => $value) {
                if (is_string($name) && strtolower($name) !== 'host') {
                    $headers[$name] = is_array($value) ? implode(',', array_map('strval', $value)) : (string) $value;
                }
            }

            return ['document' => $document, 'url' => $upload['url'], 'headers' => $headers, 'expires_at' => $expiresAt];
        });
    }

    /**
     * Verifies the stored object. Throws the matching problem after deleting the object
     * and the row when it fails.
     */
    public function confirm(Shop $shop, ShopDocument $document): ShopDocument
    {
        $outcome = DB::transaction(function () use ($shop, $document): ShopDocument|DocumentFailure {
            /** @var ShopDocument $locked */
            $locked = ShopDocument::query()
                ->whereKey($document->getKey())
                ->where('shop_id', $shop->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if ($locked->uploaded_at !== null) {
                throw ProblemException::make(ProblemCode::Conflict, 409, 'The document is already confirmed.');
            }

            $checked = $this->check($locked);

            if ($checked instanceof DocumentFailure) {
                $this->deleteObject($locked->path);
                $locked->delete();

                return $checked;
            }

            $uploadKey = $locked->path;
            $documentKey = DocumentStorage::documentKey((string) $shop->getKey(), (string) $locked->getKey());
            $this->storage->disk()->put($documentKey, $checked, ['ContentType' => $locked->mime]);
            $this->deleteObject($uploadKey);

            $locked->forceFill(['path' => $documentKey, 'uploaded_at' => now()])->save();

            return $locked;
        });

        if ($outcome instanceof DocumentFailure) {
            throw $outcome->toProblem();
        }

        return $outcome;
    }

    /**
     * The verified bytes, or why they were refused.
     */
    private function check(ShopDocument $document): string|DocumentFailure
    {
        $disk = $this->storage->disk();

        try {
            if (! $disk->exists($document->path)) {
                return DocumentFailure::MissingObject;
            }

            $size = $disk->size($document->path);
        } catch (Throwable) {
            return DocumentFailure::MissingObject;
        }

        if ($size > DocumentRules::MAX_BYTES) {
            return DocumentFailure::TooLarge;
        }

        if ($size !== $document->size) {
            return DocumentFailure::SizeMismatch;
        }

        $bytes = $disk->get($document->path);

        if (! is_string($bytes) || strlen($bytes) !== $size) {
            return DocumentFailure::SizeMismatch;
        }

        return $this->inspector->inspect($bytes, $document->mime) ?? $bytes;
    }

    private function discardStalePending(Shop $shop): void
    {
        $stale = ShopDocument::query()
            ->where('shop_id', $shop->getKey())
            ->whereNull('uploaded_at')
            ->where('created_at', '<', now()->subMinutes(DocumentRules::URL_TTL_MINUTES + self::STALE_GRACE_MINUTES))
            ->get();

        foreach ($stale as $document) {
            $this->deleteObject($document->path);
            $document->delete();
        }
    }

    private function deleteObject(string $path): void
    {
        try {
            $this->storage->disk()->delete($path);
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
