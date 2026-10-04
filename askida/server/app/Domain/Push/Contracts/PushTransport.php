<?php

namespace App\Domain\Push\Contracts;

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Push\PushMessage;

/**
 * Delivers one push message to one registered device token (FCM or APNs in
 * production, see ADR-0004). Implementations must never log or persist the token.
 */
interface PushTransport
{
    public function send(DevicePlatform $platform, #[\SensitiveParameter] string $token, PushMessage $message): void;
}
