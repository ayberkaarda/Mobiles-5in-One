<?php

namespace App\Domain\Cost;

/**
 * What is being sent, for the daily send budget. Critical kinds (verification, password
 * reset, receipt, deletion confirmation, finance alerts, payout and fraud alerts) are
 * never paused; non-critical ones (the "Yeni askı" and "Askın alındı" pushes) stop for the
 * rest of the day once the channel's cap is reached.
 */
enum SendKind: string
{
    case EmailCritical = 'email.critical';
    case EmailNonCritical = 'email.non_critical';
    case PushCritical = 'push.critical';
    case PushNonCritical = 'push.non_critical';

    public function channel(): Channel
    {
        return match ($this) {
            self::EmailCritical, self::EmailNonCritical => Channel::Email,
            self::PushCritical, self::PushNonCritical => Channel::Push,
        };
    }

    public function isCritical(): bool
    {
        return $this === self::EmailCritical || $this === self::PushCritical;
    }
}
