<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Password reset code. Queued after the database commit; the queued payload is
 * encrypted because it carries the code.
 */
class PasswordResetCodeMail extends Mailable implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $recipientName,
        public readonly string $code,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'Askıda şifre sıfırlama kodun');
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.reset-password',
            text: 'mail.reset-password-text',
            with: [
                'name' => $this->recipientName,
                'code' => $this->code,
                'minutes' => (int) config('auth.codes.ttl_minutes', 60),
            ],
        );
    }
}
