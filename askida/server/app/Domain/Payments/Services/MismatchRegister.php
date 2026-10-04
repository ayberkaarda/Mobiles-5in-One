<?php

namespace App\Domain\Payments\Services;

use App\Domain\Donations\Models\Donation;
use App\Domain\Payments\Mail\PaymentMismatchAlertMail;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Records a disagreement between our donation record and the provider, used by the
 * reconciliation job and the refund service.
 *
 * Idempotent per (donation, kind) while unresolved: the partial unique index of
 * `payment_mismatches` decides (ON CONFLICT DO NOTHING). Only a newly created row writes
 * an activity log entry and queues the finance alert, so a daily re-run does not repeat
 * alerts. `ours` and `theirs` hold statuses, amounts and ids only.
 */
class MismatchRegister
{
    public const LOG_NAME = 'payments';

    public const PROVIDER_PAID_OURS_OPEN = 'provider_paid_ours_open';

    public const AMOUNT_MISMATCH = 'amount_mismatch';

    public const CURRENCY_MISMATCH = 'currency_mismatch';

    public const OURS_PAID_PROVIDER_FAILED = 'ours_paid_provider_failed';

    public const OURS_PAID_PROVIDER_PENDING = 'ours_paid_provider_pending';

    public const REFUND_FAILED = 'refund_failed';

    /**
     * @param  array<string, scalar|null>  $ours
     * @param  array<string, scalar|null>  $theirs
     * @return bool true when a new mismatch row was created
     */
    public function record(Donation $donation, string $kind, array $ours, array $theirs): bool
    {
        $now = CarbonImmutable::now();
        $stamp = $now->format('Y-m-d H:i:s.uP');
        $id = (string) Str::uuid7();

        $created = DB::table('payment_mismatches')->insertOrIgnore([
            'id' => $id,
            'donation_id' => $donation->id,
            'kind' => $kind,
            'ours' => json_encode($ours, JSON_THROW_ON_ERROR),
            'theirs' => json_encode($theirs, JSON_THROW_ON_ERROR),
            'detected_at' => $stamp,
            'created_at' => $stamp,
            'updated_at' => $stamp,
        ]) === 1;

        if (! $created) {
            return false;
        }

        activity(self::LOG_NAME)
            ->performedOn($donation)
            ->event('payment.mismatch')
            ->withProperties(['donation_id' => $donation->id, 'mismatch_id' => $id, 'kind' => $kind])
            ->log('payment.mismatch');

        $recipient = config('payments.finance_alert_email');

        if (is_string($recipient) && $recipient !== '') {
            Mail::to($recipient)->queue(new PaymentMismatchAlertMail(
                mismatchId: $id,
                donationId: $donation->id,
                kind: $kind,
                ours: $ours,
                theirs: $theirs,
                detectedAt: $now,
            ));
        }

        return true;
    }
}
