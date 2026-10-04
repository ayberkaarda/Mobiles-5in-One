<?php

namespace App\Domain\Payments\Mail;

use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Plain-text finance alert for a payment mismatch (Turkish and English). Carries ids,
 * statuses and amounts only; never personal data or provider tokens.
 */
class PaymentMismatchAlertMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /**
     * @param  array<string, scalar|null>  $ours
     * @param  array<string, scalar|null>  $theirs
     */
    public function __construct(
        public readonly string $mismatchId,
        public readonly string $donationId,
        public readonly string $kind,
        public readonly array $ours,
        public readonly array $theirs,
        public readonly CarbonImmutable $detectedAt,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda ödeme uyuşmazlığı / payment mismatch: '.$this->kind);
    }

    public function content(): Content
    {
        return new Content(
            text: 'payments.mail.mismatch-alert-text',
            with: [
                'mismatchId' => $this->mismatchId,
                'donationId' => $this->donationId,
                'kind' => $this->kind,
                'ours' => $this->ours,
                'theirs' => $this->theirs,
                'detectedAt' => $this->detectedAt->setTimezone('Europe/Istanbul')->format('d.m.Y H:i'),
            ],
        );
    }
}
