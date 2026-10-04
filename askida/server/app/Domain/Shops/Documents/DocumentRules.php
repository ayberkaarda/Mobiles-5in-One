<?php

namespace App\Domain\Shops\Documents;

/**
 * Upload limits for verification documents (security checklist item 7).
 */
final class DocumentRules
{
    public const MAX_BYTES = 5 * 1024 * 1024;

    public const MAX_DOCUMENTS_PER_SHOP = 3;

    public const PRESIGNS_PER_SHOP_PER_DAY = 10;

    public const MAX_PDF_PAGES = 10;

    public const URL_TTL_MINUTES = 5;

    public const PRESIGN_LIMITER = 'document-presign';

    /**
     * @var list<string>
     */
    public const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
}
