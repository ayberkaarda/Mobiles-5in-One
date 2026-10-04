<?php

namespace App\Domain\Shops\Services;

use App\Domain\Shops\Documents\DocumentRules;
use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Models\ShopDocument;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Gate;

/**
 * Creates the only read URL a document ever gets: a 5-minute presigned GET on the
 * private disk, for an admin panel user holding the document permission (matrix
 * section 4, "Open a shop document"). The object store refuses any request whose
 * signature is missing, altered or expired. Each URL is logged with ids only.
 */
final class DocumentUrlSigner
{
    public function __construct(private readonly DocumentStorage $storage) {}

    public function temporaryUrl(ShopDocument $document, User $actor): string
    {
        Gate::forUser($actor)->authorize('view', $document);

        if ($document->uploaded_at === null) {
            throw ProblemException::make(ProblemCode::NotFound, 404);
        }

        $url = $this->storage->disk()->temporaryUrl(
            $document->path,
            CarbonImmutable::now()->addMinutes(DocumentRules::URL_TTL_MINUTES),
            [
                'ResponseContentType' => $document->mime,
                'ResponseContentDisposition' => 'attachment; filename="'.$document->getKey().'"',
            ],
        );

        activity(ShopVerificationService::LOG_NAME)
            ->performedOn($document)
            ->causedBy($actor)
            ->event('document.url_issued')
            ->withProperties(['shop_id' => $document->shop_id])
            ->log('document.url_issued');

        return $url;
    }
}
