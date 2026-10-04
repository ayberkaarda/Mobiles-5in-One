<?php

namespace App\Domain\Shops\Listeners;

use App\Domain\Payouts\Jobs\OnboardSubMerchant;
use App\Domain\Shops\Events\ShopVerified;

/**
 * A verified shop becomes payable once the provider knows it as a sub-merchant. The
 * event carries ids only; the queued job loads and decrypts what it needs.
 */
final class OnboardSubMerchantOnVerified
{
    public function handle(ShopVerified $event): void
    {
        OnboardSubMerchant::dispatch($event->shopId);
    }
}
