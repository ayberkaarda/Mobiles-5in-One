<?php

namespace App\Domain\Hooks\Services;

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;

/**
 * A fresh reservation. `code` is the plaintext redemption code: it exists only in this
 * object and the reserve response, never in storage or logs.
 */
final readonly class ReservedHook
{
    public function __construct(
        public string $hookId,
        #[\SensitiveParameter] public string $code,
        public CarbonImmutable $expiresAt,
        public Shop $shop,
        public Item $item,
    ) {}
}
