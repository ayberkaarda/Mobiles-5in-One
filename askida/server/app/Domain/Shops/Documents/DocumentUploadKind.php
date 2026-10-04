<?php

namespace App\Domain\Shops\Documents;

use App\Domain\Shops\Models\ShopDocumentKind;

/**
 * Document kinds a merchant can upload through the API, mapped to the stored kind.
 */
enum DocumentUploadKind: string
{
    case VergiLevhasi = 'vergi_levhasi';
    case IsletmeBelgesi = 'isletme_belgesi';

    public function storedKind(): ShopDocumentKind
    {
        return match ($this) {
            self::VergiLevhasi => ShopDocumentKind::TaxCertificate,
            self::IsletmeBelgesi => ShopDocumentKind::BusinessLicense,
        };
    }

    public static function fromStored(ShopDocumentKind $kind): ?self
    {
        return match ($kind) {
            ShopDocumentKind::TaxCertificate => self::VergiLevhasi,
            ShopDocumentKind::BusinessLicense => self::IsletmeBelgesi,
            ShopDocumentKind::Other => null,
        };
    }
}
