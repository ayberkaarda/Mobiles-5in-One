<?php

namespace App\Domain\Payments\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Donor notice of a refund (Turkish, plain text). Queued after the commit; the queued
 * payload is encrypted because it carries the recipient address. No recipient data of
 * any unit is involved: it names the item, the shop, the units and the amount.
 */
class DonationRefundedMail extends Mailable implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $itemName,
        public readonly string $shopName,
        public readonly int $units,
        public readonly int $amountMinor,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda bağışının iadesi yapıldı');
    }

    public function content(): Content
    {
        return new Content(
            text: 'payments.mail.donation-refunded-text',
            with: [
                'itemName' => $this->itemName,
                'shopName' => $this->shopName,
                'units' => $this->units,
                'amount' => self::lira($this->amountMinor),
            ],
        );
    }

    /**
     * 12345 kuruş -> "123,45 ₺".
     */
    public static function lira(int $amountMinor): string
    {
        return number_format($amountMinor / 100, 2, ',', '.').' ₺';
    }
}
