<?php

namespace App\Domain\Hooks\Listeners;

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Events\HookRedeemed;
use App\Domain\Items\Models\Item;
use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use App\Domain\Push\PushType;
use App\Domain\Shops\Models\Shop;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Story 6: the donor gets "Askın alındı" when one of their units is redeemed. The
 * message names the item and the shop and carries the ids the app routes on: no
 * recipient data, no code, no time.
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
            $event->donationId,
            $event->shopId,
        ));
    }

    /**
     * Data: `type` (hook.redeemed), the donor's own `donation_id`, the `shop_id`, and the
     * item and shop names. Never the hook id, a code or anything about the recipient.
     */
    public static function message(string $itemName, string $shopName, string $donationId, string $shopId): PushMessage
    {
        return new PushMessage(
            'Askın alındı',
            "{$shopName} içindeki askından 1 {$itemName} alındı.",
            [
                'type' => PushType::HookRedeemed->value,
                'donation_id' => $donationId,
                'shop_id' => $shopId,
                'item' => $itemName,
                'shop' => $shopName,
            ],
        );
    }
}
