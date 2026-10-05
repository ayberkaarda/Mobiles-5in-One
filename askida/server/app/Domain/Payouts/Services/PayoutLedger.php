<?php

namespace App\Domain\Payouts\Services;

use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Payouts\Data\LedgerDay;
use App\Domain\Shops\Models\Shop;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Support\Facades\DB;

/**
 * A shop's payout ledger, one row per Europe/Istanbul day that has a paid donation, a
 * redemption or a provider payout, newest first, with a keyset cursor over the day.
 * Aggregates only: no donor, recipient or redeemer identifier is ever selected. Amounts
 * are what the shop and the platform keep: a partial refund removes only the refunded
 * units and their commission share.
 */
final class PayoutLedger
{
    /** Ledger days are Europe/Istanbul calendar days (written literally in the SQL). */
    public const TIMEZONE = 'Europe/Istanbul';

    /**
     * Paid and refunded donations with their completed refund (if any). What the shop and
     * the platform keep is the donation minus the refunded amount and refunded commission;
     * a refunded donation without a refund record (written before refunds were recorded)
     * counts as fully refunded.
     */
    private const KEPT_DONATIONS = <<<'SQL'
        SELECT d.paid_at,
               d.amount_minor - COALESCE(r.amount_minor, CASE WHEN d.status = 'refunded' THEN d.amount_minor ELSE 0 END) AS kept_amount,
               d.commission_minor - COALESCE(r.commission_minor, CASE WHEN d.status = 'refunded' THEN d.commission_minor ELSE 0 END) AS kept_commission
          FROM donations d
          LEFT JOIN donation_refunds r ON r.donation_id = d.id AND r.status = 'succeeded'
         WHERE d.shop_id = ? AND d.status IN ('paid', 'refunded') AND d.paid_at IS NOT NULL
        SQL;

    /**
     * @return array{days: list<LedgerDay>, next_cursor: string|null}
     */
    public function page(Shop $shop, int $limit, ?string $cursor): array
    {
        $before = $cursor === null ? null : self::decodeCursor($cursor);
        $dates = $this->dates($shop, $limit + 1, $before);
        $next = null;

        if (count($dates) > $limit) {
            $dates = array_slice($dates, 0, $limit);
            $next = self::encodeCursor($dates[$limit - 1]);
        }

        if ($dates === []) {
            return ['days' => [], 'next_cursor' => null];
        }

        $from = $dates[count($dates) - 1];
        $to = $dates[0];
        $donations = $this->donations($shop, $from, $to);
        $redeemed = $this->redemptions($shop, $from, $to);
        $payouts = $this->payouts($shop, $from, $to);

        $days = [];

        foreach ($dates as $date) {
            $payout = $payouts[$date] ?? null;

            $days[] = new LedgerDay(
                date: $date,
                donatedMinor: $donations[$date]['donated'] ?? 0,
                commissionMinor: $donations[$date]['commission'] ?? 0,
                redeemedCount: $redeemed[$date] ?? 0,
                settlementStatus: $payout['status'] ?? 'none',
                settlementAmountMinor: $payout['amount'] ?? null,
            );
        }

        return ['days' => $days, 'next_cursor' => $next];
    }

    /**
     * @return list<string> Y-m-d, newest first
     */
    private function dates(Shop $shop, int $limit, ?string $before): array
    {
        $bindings = [$shop->id, $shop->id, HookStatus::Redeemed->value, $shop->id];
        $days = "SELECT d::text AS d FROM (
                SELECT (paid_at AT TIME ZONE 'Europe/Istanbul')::date AS d FROM (".self::KEPT_DONATIONS.") kept
                    WHERE kept_amount > 0
                UNION
                SELECT (redeemed_at AT TIME ZONE 'Europe/Istanbul')::date FROM hooks
                    WHERE shop_id = ? AND status = ? AND redeemed_at IS NOT NULL
                UNION
                SELECT period FROM payouts WHERE shop_id = ?
            ) days";

        if ($before === null) {
            $rows = DB::select($days.' ORDER BY d DESC LIMIT ?', [...$bindings, $limit]);
        } else {
            $rows = DB::select($days.' WHERE d < ?::date ORDER BY d DESC LIMIT ?', [...$bindings, $before, $limit]);
        }

        $dates = [];

        foreach ($rows as $row) {
            /** @var object{d: string} $row */
            $dates[] = (string) $row->d;
        }

        return $dates;
    }

    /**
     * @return array<string, array{donated: int, commission: int}>
     */
    private function donations(Shop $shop, string $from, string $to): array
    {
        $rows = DB::select(
            "SELECT (paid_at AT TIME ZONE 'Europe/Istanbul')::date::text AS d, SUM(kept_amount) AS donated, SUM(kept_commission) AS commission
               FROM (".self::KEPT_DONATIONS.") kept
              WHERE (paid_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN ?::date AND ?::date
              GROUP BY 1",
            [$shop->id, $from, $to],
        );

        $out = [];

        foreach ($rows as $row) {
            /** @var object{d: string, donated: int|string, commission: int|string} $row */
            $out[(string) $row->d] = ['donated' => (int) $row->donated, 'commission' => (int) $row->commission];
        }

        return $out;
    }

    /**
     * @return array<string, int>
     */
    private function redemptions(Shop $shop, string $from, string $to): array
    {
        $rows = DB::table('hooks')
            ->where('shop_id', $shop->id)
            ->where('status', HookStatus::Redeemed->value)
            ->whereNotNull('redeemed_at')
            ->whereRaw("(redeemed_at AT TIME ZONE 'Europe/Istanbul')::date BETWEEN ?::date AND ?::date", [$from, $to])
            ->groupByRaw("(redeemed_at AT TIME ZONE 'Europe/Istanbul')::date")
            ->selectRaw("(redeemed_at AT TIME ZONE 'Europe/Istanbul')::date::text AS d, COUNT(*) AS n")
            ->get();

        $out = [];

        foreach ($rows as $row) {
            $out[(string) $row->d] = (int) $row->n;
        }

        return $out;
    }

    /**
     * @return array<string, array{status: string, amount: int}>
     */
    private function payouts(Shop $shop, string $from, string $to): array
    {
        $rows = DB::table('payouts')
            ->where('shop_id', $shop->id)
            ->whereRaw('period BETWEEN ?::date AND ?::date', [$from, $to])
            ->groupBy('period')
            ->selectRaw("period::text AS d,
                BOOL_OR(hold OR status = 'held') AS any_held,
                BOOL_OR(status = 'failed') AS any_failed,
                BOOL_OR(status = 'pending') AS any_pending,
                SUM(amount_minor) AS amount")
            ->get();

        $out = [];

        foreach ($rows as $row) {
            $status = match (true) {
                (bool) $row->any_held => 'held',
                (bool) $row->any_failed => 'failed',
                (bool) $row->any_pending => 'pending',
                default => 'settled',
            };

            $out[(string) $row->d] = ['status' => $status, 'amount' => (int) $row->amount];
        }

        return $out;
    }

    private static function encodeCursor(string $date): string
    {
        return rtrim(strtr(base64_encode((string) json_encode(['before' => $date])), '+/', '-_'), '=');
    }

    private static function decodeCursor(string $cursor): string
    {
        $json = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = is_string($json) ? json_decode($json, true) : null;
        $date = is_array($value) ? ($value['before'] ?? null) : null;

        if (! is_string($date)
            || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1
            || ! checkdate((int) substr($date, 5, 2), (int) substr($date, 8, 2), (int) substr($date, 0, 4))) {
            throw ProblemException::make(ProblemCode::ValidationFailed, 422, errors: [['field' => 'cursor', 'code' => 'invalid']]);
        }

        return $date;
    }
}
