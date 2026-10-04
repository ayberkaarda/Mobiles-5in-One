<?php

namespace App\Domain\Fraud\Services;

use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Fraud\Models\AbuseFlagKind;
use App\Domain\Shops\Models\Shop;
use Illuminate\Support\Facades\DB;

/**
 * Writes `abuse_flags` rows. Idempotent per (shop, kind) while a flag is unreviewed:
 * a second finding of the same kind adds nothing until a reviewer has closed the first.
 * `detail` must hold counters and thresholds only, never personal data.
 */
final class AbuseFlagger
{
    /**
     * @param  array<string, int|float|string|null>  $detail
     * @return AbuseFlag|null the new flag, or null when an unreviewed one already exists
     */
    public function raise(Shop $shop, AbuseFlagKind $kind, array $detail): ?AbuseFlag
    {
        return DB::transaction(function () use ($shop, $kind, $detail): ?AbuseFlag {
            // Serialises concurrent writers of the same (shop, kind) for this transaction.
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['abuse_flag:'.$shop->id.':'.$kind->value]);

            if ($this->openFlag($shop, $kind) !== null) {
                return null;
            }

            $flag = new AbuseFlag;
            $flag->forceFill([
                'shop_id' => $shop->id,
                'kind' => $kind->value,
                'detail' => $detail,
            ])->save();

            return $flag;
        });
    }

    public function openFlag(Shop $shop, AbuseFlagKind $kind): ?AbuseFlag
    {
        return AbuseFlag::query()
            ->where('shop_id', $shop->id)
            ->where('kind', $kind->value)
            ->whereNull('reviewed_at')
            ->first();
    }
}
