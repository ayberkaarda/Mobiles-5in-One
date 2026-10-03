<?php

namespace App\Domain\Shops\Models;

/**
 * Verification document kinds (vergi levhası, işletme belgesi, other supporting paper).
 */
enum ShopDocumentKind: string
{
    case TaxCertificate = 'tax_certificate';
    case BusinessLicense = 'business_license';
    case Other = 'other';
}
