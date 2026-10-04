<?php

namespace App\Domain\Payments\Mail;

use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Receipt of a paid donation (Turkish). Shows the shop, the item, the quantity, the
 * amount, the platform commission and the net to the shop. It never names anyone who
 * collects a unit: no such data exists at payment time and none is ever added.
 *
 * Sent from the queued SendDonationReceipt job, whose payload holds the donation id only.
 */
class DonationReceiptMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $donationId,
        public readonly string $shopName,
        public readonly string $itemName,
        public readonly int $qty,
        public readonly int $amountMinor,
        public readonly int $commissionMinor,
        public readonly CarbonImmutable $paidAt,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda bağış makbuzun');
    }

    public function content(): Content
    {
        return new Content(
            view: 'payments.mail.receipt',
            text: 'payments.mail.receipt-text',
            with: [
                'reference' => strtoupper(substr(str_replace('-', '', $this->donationId), -12)),
                'shop' => $this->shopName,
                'item' => $this->itemName,
                'qty' => $this->qty,
                'amount' => self::lira($this->amountMinor),
                'commission' => self::lira($this->commissionMinor),
                'net' => self::lira($this->amountMinor - $this->commissionMinor),
                'paidAt' => $this->paidAt->setTimezone((string) config('app.timezone'))->format('d.m.Y H:i'),
            ],
        );
    }

    /**
     * Kuruş to a Turkish lira string: 150050 -> "1.500,50 ₺".
     */
    public static function lira(int $minor): string
    {
        return number_format(intdiv($minor, 100), 0, ',', '.').','.str_pad((string) ($minor % 100), 2, '0', STR_PAD_LEFT).' ₺';
    }
}
