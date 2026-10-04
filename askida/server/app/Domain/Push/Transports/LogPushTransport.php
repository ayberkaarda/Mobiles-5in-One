<?php

namespace App\Domain\Push\Transports;

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\PushMessage;
use Psr\Log\LoggerInterface;

/**
 * Local and test transport: writes the message shape (platform, title, body, data) to
 * the application log, which runs through the masking processor. No network call, and
 * the device token is never written. Refused outside `local` and `testing`.
 */
final class LogPushTransport implements PushTransport
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function send(DevicePlatform $platform, #[\SensitiveParameter] string $token, PushMessage $message): void
    {
        $this->logger->info('push.sent', [
            'transport' => 'log',
            'platform' => $platform->value,
            'message' => $message->toArray(),
        ]);
    }
}
