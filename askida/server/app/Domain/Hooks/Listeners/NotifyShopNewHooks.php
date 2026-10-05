<?php

namespace App\Domain\Hooks\Listeners;

use App\Domain\Hooks\Events\HooksIssued;
use App\Domain\Items\Models\Item;
use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use App\Domain\Push\PushType;
use App\Domain\Shops\Models\ShopMember;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Story 9: owner and staff of the shop get "Yeni askı" when units are issued. The
 * message carries the count, the item name and the shop id, never the donor.
 */
final class NotifyShopNewHooks implements ShouldQueue
{
    public function viaQueue(): string
    {
        return (string) config('askida.push.queue', 'push');
    }

    public function handle(HooksIssued $event): void
    {
        $itemName = (string) Item::query()->whereKey($event->itemId)->value('name');
        $message = self::message($event->count, $itemName, $event->shopId);

        ShopMember::query()
            ->where('shop_id', $event->shopId)
            ->pluck('user_id')
            ->each(static function (mixed $userId) use ($message): void {
                if (is_string($userId)) {
                    SendPush::dispatch($userId, $message);
                }
            });
    }

    /**
     * Data: `type` (hooks.issued), the `shop_id` whose redemptions the app opens, the item
     * name and the count. No donation id and nothing about the donor.
     */
    public static function message(int $count, string $itemName, string $shopId): PushMessage
    {
        return new PushMessage(
            'Yeni askı',
            "{$count} {$itemName} askıya bırakıldı.",
            [
                'type' => PushType::HooksIssued->value,
                'shop_id' => $shopId,
                'item' => $itemName,
                'count' => (string) $count,
            ],
        );
    }
}
