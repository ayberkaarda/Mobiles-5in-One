<?php

namespace App\Domain\Admin\Services;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Activity log entries for the admin panel (log name `admin`): sign-in events and
 * every change made through the panel. Entries hold ids, state names and the reason or
 * note typed by the staff member; never secrets, codes, e-mail addresses, tax numbers
 * or IBANs.
 */
final class AdminAudit
{
    public const LOG_NAME = 'admin';

    /**
     * Property keys an entry may carry. Anything else is dropped, so a caller cannot
     * leak a value into the log by passing it along.
     */
    public const ALLOWED_PROPERTIES = [
        'reason', 'note', 'role', 'from', 'to', 'kind', 'shop_id', 'donation_id', 'payout_id', 'remaining_recovery_codes', 'method',
    ];

    /**
     * @param  array<string, scalar|null>  $properties
     */
    public static function log(string $event, ?User $causer, ?Model $subject = null, array $properties = []): void
    {
        $logger = activity(self::LOG_NAME)
            ->event($event)
            ->withProperties(array_intersect_key($properties, array_flip(self::ALLOWED_PROPERTIES)));

        if ($causer !== null) {
            $logger->causedBy($causer);
        }

        if ($subject !== null) {
            $logger->performedOn($subject);
        }

        $logger->log($event);
    }
}
