<?php

namespace App\Domain\Payments\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Finance alert: a provider payment disagrees with a donation during settlement. Carries
 * the donation id and the mismatch kinds only (no amounts of a person, no token, no
 * personal data); details are in the panel's payment mismatches view.
 */
class SettlementMismatchMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /**
     * @param  list<string>  $kinds
     */
    public function __construct(
        public readonly string $donationId,
        public readonly array $kinds,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda ödeme uyuşmazlığı');
    }

    public function content(): Content
    {
        return new Content(
            text: 'payments.mail.settlement-mismatch-text',
            with: ['donationId' => $this->donationId, 'kinds' => $this->kinds],
        );
    }
}
