<?php

namespace App\Domain\Accounts\Mail;

use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Confirmation of an account deletion request. Queued after the database commit; the
 * queued payload is encrypted because it carries the recipient's name.
 */
class AccountDeletionRequestedMail extends Mailable implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly CarbonImmutable $graceUntil,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda hesap silme talebin alındı');
    }

    public function content(): Content
    {
        return new Content(
            view: 'accounts.mail.deletion-requested',
            text: 'accounts.mail.deletion-requested-text',
            with: [
                'name' => $this->recipientName,
                'until' => $this->graceUntil->setTimezone((string) config('app.timezone'))->format('d.m.Y H:i'),
            ],
        );
    }
}
