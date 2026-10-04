<?php

namespace App\Domain\Hooks\Listeners;

use App\Domain\Hooks\Events\HooksIssued;
use App\Domain\Items\Models\Item;
use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use App\Domain\Shops\Models\ShopMember;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Story 9: owner and staff of the shop get "Yeni askı" when units are issued. The
 * message carries the count and the item name only, never the donor.
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
        $message = self::message($event->count, $itemName);

        ShopMember::query()
            ->where('shop_id', $event->shopId)
            ->pluck('user_id')
            ->each(static function (mixed $userId) use ($message): void {
                if (is_string($userId)) {
                    SendPush::dispatch($userId, $message);
                }
            });
    }

    public static function message(int $count, string $itemName): PushMessage
    {
        return new PushMessage(
            'Yeni askı',
            "{$count} {$itemName} askıya bırakıldı.",
            ['item' => $itemName, 'count' => (string) $count],
        );
    }
}
