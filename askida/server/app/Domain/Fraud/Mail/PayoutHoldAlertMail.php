<?php

namespace App\Domain\Fraud\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Finance alert: the fraud scan held a shop's payouts. Carries ids and counters only
 * (no personal data), so the queued payload needs no encryption.
 */
class PayoutHoldAlertMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /**
     * @param  array<string, int|float|string|null>  $detail
     */
    public function __construct(
        public readonly string $shopId,
        public readonly string $flagId,
        public readonly string $kind,
        public readonly array $detail,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda: esnaf ödemeleri bekletmeye alındı');
    }

    public function content(): Content
    {
        return new Content(
            view: 'fraud.mail.payout-hold-alert',
            text: 'fraud.mail.payout-hold-alert-text',
            with: [
                'shopId' => $this->shopId,
                'flagId' => $this->flagId,
                'kind' => $this->kind,
                'detail' => $this->detail,
            ],
        );
    }
}
