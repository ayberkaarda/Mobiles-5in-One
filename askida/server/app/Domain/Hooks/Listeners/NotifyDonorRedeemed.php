<?php

namespace App\Domain\Hooks\Listeners;

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Events\HookRedeemed;
use App\Domain\Items\Models\Item;
use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use App\Domain\Shops\Models\Shop;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Story 6: the donor gets "Askın alındı" when one of their units is redeemed. The
 * message names the item and the shop only: no recipient data, no code, no time.
 * Anonymised donations (donor deleted) send nothing.
 */
final class NotifyDonorRedeemed implements ShouldQueue
{
    public function viaQueue(): string
    {
        return (string) config('askida.push.queue', 'push');
    }

    public function handle(HookRedeemed $event): void
    {
        $donorId = Donation::query()->whereKey($event->donationId)->value('donor_id');

        if (! is_string($donorId)) {
            return;
        }

        SendPush::dispatch($donorId, self::message(
            (string) Item::query()->whereKey($event->itemId)->value('name'),
            (string) Shop::query()->whereKey($event->shopId)->value('name'),
        ));
    }

    public static function message(string $itemName, string $shopName): PushMessage
    {
        return new PushMessage(
            'Askın alındı',
            "{$shopName} içindeki askından 1 {$itemName} alındı.",
            ['item' => $itemName, 'shop' => $shopName],
        );
    }
}
