<?php

namespace Database\Factories;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ShopDocument>
 */
class ShopDocumentFactory extends Factory
{
    protected $model = ShopDocument::class;

    private static int $sequence = 0;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;

        return [
            'shop_id' => Shop::factory(),
            'kind' => ShopDocumentKind::TaxCertificate,
            'path' => sprintf('shop-documents/sample/%06d.pdf', $n),
            'mime' => 'application/pdf',
            'size' => 120_000 + $n,
            'reviewed_at' => null,
        ];
    }
}
