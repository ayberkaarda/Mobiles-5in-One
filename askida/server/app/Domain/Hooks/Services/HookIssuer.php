<?php

namespace App\Domain\Hooks\Services;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Events\HooksIssued;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Creates the AVAILABLE units of a paid donation (called when a payment is confirmed).
 *
 * Idempotent: inside a transaction the donation row is locked `FOR UPDATE`, existing
 * units are counted and only the missing ones up to `qty` are created, so a replayed or
 * parallel call creates nothing more. `donations.hooks_issued_at` is set when that
 * column exists (added by the payments phase).
 */
class HookIssuer
{
    public function issueForDonation(Donation $donation): int
    {
        return DB::transaction(function () use ($donation): int {
            /** @var Donation $locked */
            $locked = Donation::query()->whereKey($donation->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status !== DonationStatus::Paid) {
                throw new HookIssuanceRefused('Units are issued only for paid donations.');
            }

            $existing = Hook::query()->where('donation_id', $locked->id)->count();
            $missing = max(0, $locked->qty - $existing);
            $now = HookReleaseService::stamp(CarbonImmutable::now());

            if ($missing > 0) {
                $rows = [];

                for ($i = 0; $i < $missing; $i++) {
                    $rows[] = [
                        'id' => (string) Str::uuid7(),
                        'donation_id' => $locked->id,
                        'shop_id' => $locked->shop_id,
                        'item_id' => $locked->item_id,
                        'status' => HookStatus::Available->value,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }

                DB::table('hooks')->insert($rows);
                event(new HooksIssued($locked->id, $locked->shop_id, $locked->item_id, $missing));
            }

            if (Schema::hasColumn('donations', 'hooks_issued_at')) {
                DB::table('donations')->where('id', $locked->id)->whereNull('hooks_issued_at')->update(['hooks_issued_at' => $now]);
            }

            return $missing;
        });
    }
}
