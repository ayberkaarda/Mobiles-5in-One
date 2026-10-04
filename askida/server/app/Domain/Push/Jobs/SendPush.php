<?php

namespace App\Domain\Push\Jobs;

use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\PushMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Sends one message to every registered device of a user, on the `push` queue.
 *
 * The payload holds the user id and the message only; device tokens are read at send
 * time and never enter the queue. Deliveries count against a global hourly fan-out cap
 * (askida.push.hourly_fanout_cap, security item 22): above it the remaining deliveries
 * are dropped with a warning instead of queued again.
 */
final class SendPush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public const FANOUT_KEY = 'push:fanout';

    public int $tries = 3;

    public function __construct(
        public readonly string $userId,
        public readonly PushMessage $message,
    ) {
        $this->onQueue((string) config('askida.push.queue', 'push'));
    }

    public function handle(PushTransport $transport, RateLimiter $limiter): void
    {
        $cap = max(0, (int) config('askida.push.hourly_fanout_cap', 2000));
        $tokens = DevicePushToken::query()->where('user_id', $this->userId)->orderBy('created_at')->get();

        foreach ($tokens as $token) {
            if ($limiter->tooManyAttempts(self::FANOUT_KEY, $cap)) {
                Log::warning('push.fanout_cap_reached', ['cap' => $cap]);

                return;
            }

            $limiter->hit(self::FANOUT_KEY, 3600);
            $transport->send($token->platform, $token->token, $this->message);
        }
    }
}
