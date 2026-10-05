<?php

namespace App\Domain\Cost\Listeners;

use App\Domain\Cost\Contracts\NonCriticalMail;
use App\Domain\Cost\SendBudget;
use App\Domain\Cost\SendKind;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Log;

/**
 * Counts every outgoing e-mail against the daily budget and drops a non-critical one once
 * the cap is reached (returning false cancels the send). Critical mail is always counted
 * and sent.
 */
final class EnforceMailBudget
{
    public function __construct(private readonly SendBudget $budget) {}

    public function handle(MessageSending $event): ?bool
    {
        $kind = self::kindOf($event);

        if (! $this->budget->allows($kind)) {
            Log::warning('cost.mail_dropped', ['kind' => $kind->value]);

            return false;
        }

        $this->budget->record($kind);

        return null;
    }

    public static function kindOf(MessageSending $event): SendKind
    {
        $mailable = $event->data['__laravel_mailable'] ?? null;

        return is_string($mailable) && is_subclass_of($mailable, NonCriticalMail::class)
            ? SendKind::EmailNonCritical
            : SendKind::EmailCritical;
    }
}
