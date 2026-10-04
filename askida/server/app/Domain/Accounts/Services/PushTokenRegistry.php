<?php

namespace App\Domain\Accounts\Services;

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DevicePushToken;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Push registrations of donor and merchant devices.
 *
 * - One row per registration token. A token is a device address, so when another
 *   account registers the same token the row moves to that account (the device now
 *   belongs to whoever signed in last).
 * - At most MAX_PER_USER rows per account; registering one more drops the least
 *   recently registered ones.
 * - The token value is never returned or logged by this class.
 */
class PushTokenRegistry
{
    public const MAX_PER_USER = 10;

    public function register(User $user, DevicePlatform $platform, string $token): void
    {
        DB::transaction(function () use ($user, $platform, $token): void {
            // Serialises registrations of one account so the cap cannot be overrun by
            // parallel requests.
            User::query()->whereKey($user->getKey())->lockForUpdate()->first();

            $now = Carbon::now();

            $row = DevicePushToken::query()->where('token', $token)->lockForUpdate()->first()
                ?? new DevicePushToken(['token' => $token]);

            $row->user_id = $user->id;
            $row->platform = $platform;
            $row->last_used_at = $now->toImmutable();
            $row->save();

            $keep = DevicePushToken::query()
                ->where('user_id', $user->id)
                ->orderByDesc('last_used_at')
                ->orderByDesc('id')
                ->limit(self::MAX_PER_USER)
                ->pluck('id');

            DevicePushToken::query()
                ->where('user_id', $user->id)
                ->whereNotIn('id', $keep)
                ->delete();
        });
    }

    public function forgetAll(User $user): int
    {
        return DevicePushToken::query()->where('user_id', $user->id)->delete();
    }
}
