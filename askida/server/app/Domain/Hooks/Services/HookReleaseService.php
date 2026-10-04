<?php

namespace App\Domain\Hooks\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Returns RESERVED units to AVAILABLE and clears every reservation column (anon_id,
 * code_hash, reserved_at, expires_at), as the state-shape CHECK of `hooks` requires.
 *
 * Every statement picks its rows with `FOR UPDATE SKIP LOCKED` and re-checks
 * `status = 'RESERVED'`, so a unit that a redeem transaction holds is skipped (the
 * redeem decides it), a unit is released at most once even with parallel callers, and
 * a REDEEMED unit is never touched (the database trigger would refuse it anyway).
 * Used by the `hooks.release-expired` job, lazily inside reserve and redeem, and by the
 * anon device deletion.
 */
class HookReleaseService
{
    private const RELEASE_EXPIRED = <<<'SQL'
        UPDATE hooks
           SET status = 'AVAILABLE', anon_id = NULL, code_hash = NULL, reserved_at = NULL, expires_at = NULL, updated_at = ?
         WHERE status = 'RESERVED'
           AND id IN (
                SELECT id FROM hooks
                 WHERE status = 'RESERVED' AND expires_at <= ?
                 ORDER BY expires_at
                 LIMIT ?
                 FOR UPDATE SKIP LOCKED)
        SQL;

    private const RELEASE_EXPIRED_FOR_ITEM = <<<'SQL'
        UPDATE hooks
           SET status = 'AVAILABLE', anon_id = NULL, code_hash = NULL, reserved_at = NULL, expires_at = NULL, updated_at = ?
         WHERE status = 'RESERVED'
           AND id IN (
                SELECT id FROM hooks
                 WHERE status = 'RESERVED' AND shop_id = ? AND item_id = ? AND expires_at <= ?
                 FOR UPDATE SKIP LOCKED)
        SQL;

    private const RELEASE_ONE_EXPIRED = <<<'SQL'
        UPDATE hooks
           SET status = 'AVAILABLE', anon_id = NULL, code_hash = NULL, reserved_at = NULL, expires_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'RESERVED' AND expires_at <= ?
        SQL;

    private const RELEASE_FOR_ANON = <<<'SQL'
        UPDATE hooks
           SET status = 'AVAILABLE', anon_id = NULL, code_hash = NULL, reserved_at = NULL, expires_at = NULL, updated_at = ?
         WHERE status = 'RESERVED'
           AND id IN (
                SELECT id FROM hooks
                 WHERE status = 'RESERVED' AND anon_id = ?
                 FOR UPDATE)
        SQL;

    /**
     * Releases every reservation whose deadline passed, in batches. Returns the number
     * of units released by this call.
     */
    public function releaseExpired(?CarbonImmutable $now = null): int
    {
        $now ??= CarbonImmutable::now();
        $batch = max(1, (int) config('askida.hooks.release_batch_size', 500));
        $total = 0;

        do {
            $released = DB::transaction(fn (): int => DB::update(self::RELEASE_EXPIRED, [
                self::stamp($now),
                self::stamp($now),
                $batch,
            ]));
            $total += $released;
        } while ($released === $batch);

        return $total;
    }

    /**
     * Lazy expiry for one shop item, run inside the reserve transaction.
     */
    public function releaseExpiredFor(string $shopId, string $itemId, CarbonImmutable $now): int
    {
        return DB::update(self::RELEASE_EXPIRED_FOR_ITEM, [self::stamp($now), $shopId, $itemId, self::stamp($now)]);
    }

    /**
     * Lazy expiry of a single unit already locked by the caller (redeem).
     */
    public function releaseIfExpired(string $hookId, CarbonImmutable $now): bool
    {
        return DB::update(self::RELEASE_ONE_EXPIRED, [self::stamp($now), $hookId, self::stamp($now)]) === 1;
    }

    /**
     * Gives back every live reservation of an anon device (device deletion).
     */
    public function releaseForAnon(string $anonId, ?CarbonImmutable $now = null): int
    {
        return DB::update(self::RELEASE_FOR_ANON, [self::stamp($now ?? CarbonImmutable::now()), $anonId]);
    }

    /**
     * Timestamps are sent with their offset and microseconds, so the stored instant
     * does not depend on the session time zone.
     */
    public static function stamp(CarbonImmutable $time): string
    {
        return $time->format('Y-m-d H:i:s.uP');
    }
}
