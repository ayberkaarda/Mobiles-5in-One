<?php

namespace App\Domain\Payments\Listeners;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Payments\Jobs\ProcessPaymentEvent;
use App\Domain\Payments\Services\RefundService;
use App\Domain\Shops\Events\ShopRejected;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Log;

/**
 * A rejected shop can no longer hand out its units: every paid donation of the shop that
 * still has AVAILABLE or RESERVED units is refunded for those units (queue `payments`).
 * A provider outage makes the listener retry with backoff. A paid donation whose units
 * are already EXPIRED (an earlier attempt expired them, then the provider failed) is
 * picked up again; donations already refunded are skipped, so a retry repeats nothing.
 */
final class OnShopRejectedRefund implements ShouldQueue
{
    public const REASON = 'shop_rejected';

    public string $queue = ProcessPaymentEvent::QUEUE;

    public int $tries = 5;

    /**
     * @var list<int>
     */
    public array $backoff = [60, 300, 900, 3600];

    public function __construct(private readonly RefundService $refunds) {}

    public function handle(ShopRejected $event): void
    {
        $actor = User::query()->find($event->actorId);

        Donation::query()
            ->where('shop_id', $event->shopId)
            ->where('status', DonationStatus::Paid->value)
            ->whereHas('hooks', static function (Builder $hooks): void {
                $hooks->whereIn('status', [HookStatus::Available->value, HookStatus::Reserved->value, HookStatus::Expired->value]);
            })
            ->chunkById(100, function ($donations) use ($actor): void {
                foreach ($donations as $donation) {
                    /** @var Donation $donation */
                    $outcome = $this->refunds->refundDonation($donation, self::REASON, $actor instanceof User ? $actor : null);

                    Log::info('payments.refund.shop_rejected', ['donation_id' => $donation->id, 'outcome' => $outcome->value]);
                }
            });
    }
}
