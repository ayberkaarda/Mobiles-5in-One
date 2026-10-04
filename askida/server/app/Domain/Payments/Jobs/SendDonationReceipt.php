<?php

namespace App\Domain\Payments\Jobs;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Mail\DonationReceiptMail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;

/**
 * Sends the donor the receipt of a paid donation. The payload is the donation id only:
 * the donor's address and the amounts are read at send time. Nothing is sent for a
 * donation that is not paid, has no donor any more (deleted account) or whose donor is
 * deactivated.
 */
final class SendDonationReceipt implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    public function __construct(
        public readonly string $donationId,
    ) {}

    public function handle(): void
    {
        /** @var Donation|null $donation */
        $donation = Donation::query()->with(['donor', 'shop', 'item'])->find($this->donationId);
        $donor = $donation?->donor;

        if ($donation === null || $donation->status !== DonationStatus::Paid || $donor === null || $donor->isDeactivated()) {
            return;
        }

        Mail::to($donor->email)->send(new DonationReceiptMail(
            donationId: $donation->id,
            shopName: (string) $donation->shop?->name,
            itemName: (string) $donation->item?->name,
            qty: $donation->qty,
            amountMinor: $donation->amount_minor,
            commissionMinor: $donation->commission_minor,
            paidAt: $donation->paid_at ?? $donation->updated_at ?? now()->toImmutable(),
        ));
    }
}
