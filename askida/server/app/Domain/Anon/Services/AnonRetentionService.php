<?php

namespace App\Domain\Anon\Services;

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Hooks\Services\HookDay;
use App\Domain\Hooks\Services\HookReleaseService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Retention of recipient-linked data (rule AN-6): nothing per device survives beyond
 * askida.hooks.retention_days days.
 * - daily counters of older days are deleted;
 * - redeemed or expired units older than the window lose their device link
 *   (`anon_id` set NULL, which the REDEEMED-is-final trigger allows).
 * Counts per shop and district live on only as aggregates (impact snapshots).
 */
class AnonRetentionService
{
    /**
     * @return array{counters: int, hook_links: int}
     */
    public function purge(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $days = max(1, (int) config('askida.hooks.retention_days', 30));
        $cutoff = $now->setTimezone(HookDay::TIMEZONE)->startOfDay()->subDays($days);

        return DB::transaction(function () use ($cutoff, $now): array {
            $counters = AnonDailyCounter::query()->where('day', '<', $cutoff->toDateString())->delete();

            $redeemed = DB::table('hooks')
                ->where('status', HookStatus::Redeemed->value)
                ->whereNotNull('anon_id')
                ->where('redeemed_at', '<', HookReleaseService::stamp($cutoff))
                ->update(['anon_id' => null, 'updated_at' => HookReleaseService::stamp($now)]);

            $expired = DB::table('hooks')
                ->where('status', HookStatus::Expired->value)
                ->whereNotNull('anon_id')
                ->where('updated_at', '<', HookReleaseService::stamp($cutoff))
                ->update(['anon_id' => null, 'updated_at' => HookReleaseService::stamp($now)]);

            return ['counters' => (int) $counters, 'hook_links' => $redeemed + $expired];
        });
    }
}
