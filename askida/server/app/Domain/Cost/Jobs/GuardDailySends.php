<?php

namespace App\Domain\Cost\Jobs;

use App\Domain\Cost\Channel;
use App\Domain\Cost\SendBudget;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Mail\Message;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * cost.guard (every 15 minutes): when today's e-mail or push count has reached its cap,
 * pause the non-critical sends of that channel for the rest of the day and mail finance
 * once per day and channel. Critical sends are never paused.
 */
final class GuardDailySends implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public const NAME = 'cost.guard';

    public int $uniqueFor = 600;

    public function handle(SendBudget $budget): void
    {
        foreach (Channel::cases() as $channel) {
            $cap = $channel->cap();
            $sent = $budget->sent($channel);

            if ($sent < $cap) {
                continue;
            }

            $budget->pause($channel);

            if ($budget->claimAlert($channel)) {
                $this->alert($budget, $channel, $sent, $cap);
            }
        }
    }

    private function alert(SendBudget $budget, Channel $channel, int $sent, int $cap): void
    {
        $recipient = config('payments.finance_alert_email');

        if (! is_string($recipient) || $recipient === '') {
            Log::warning('cost.alert_without_recipient', ['channel' => $channel->value]);

            return;
        }

        $day = $budget->day();
        $name = $channel->value;
        $body = "Askıda günlük {$name} limiti doldu / daily {$name} cap reached.\n\n"
            ."day: {$day}\nsent: {$sent}\ncap: {$cap}\n\n"
            .'Kritik gönderimler (doğrulama, şifre sıfırlama, makbuz, silme onayı, finans uyarıları) sürer; '
            ."kritik olmayan {$name} gönderimleri gün sonuna kadar durduruldu.\n"
            ."Critical sends continue; non-critical {$name} sends are paused until the end of the day.\n";

        try {
            Mail::raw($body, static function (Message $message) use ($recipient, $name, $day): void {
                $message->to($recipient)->subject("Askıda günlük {$name} limiti / daily cap reached {$day}");
            });
        } catch (Throwable $e) {
            // Let the next run retry the alert, then fail this run visibly.
            $budget->releaseAlert($channel);

            throw $e;
        }
    }
}
