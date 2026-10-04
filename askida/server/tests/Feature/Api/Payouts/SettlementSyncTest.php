<?php

use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payouts\Services\PayoutSynchronizer;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Support\Payouts\PayoutWorld;
use Tests\Support\Payouts\ScriptedPayoutGateway;

/*
| payouts.sync: provider settlements of the last 14 days mirrored into payouts.
| Provider `paid` is stored as `settled` (database vocabulary).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->gateway = ScriptedPayoutGateway::bind();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
});

function syncNow(): array
{
    return app(PayoutSynchronizer::class)->syncAll();
}

function payoutBySettlement(string $id): Payout
{
    return Payout::query()->where('provider_settlement_id', $id)->firstOrFail();
}

it('upserts provider settlements with the status mapping and the 14-day period', function (): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    PayoutWorld::shopWithFinancials(); // no key: never asked
    $this->gateway->settlements[$key] = [
        PayoutWorld::record('st-a', $key, 12_000, 'paid', '2026-10-01'),
        PayoutWorld::record('st-b', $key, 8_000, 'pending', '2026-10-03'),
        PayoutWorld::record('st-c', $key, 5_000, 'failed', '2026-10-02'),
    ];

    $summary = syncNow();

    expect($summary['shops'])->toBe(1)
        ->and($summary['created'])->toBe(3)
        ->and($this->gateway->settlementCalls)->toHaveCount(1)
        ->and($this->gateway->settlementCalls[0]['key'])->toBe($key)
        ->and($this->gateway->settlementCalls[0]['period']->getStartDate()->toDateString())->toBe('2026-09-21')
        ->and($this->gateway->settlementCalls[0]['period']->getEndDate()?->toDateString())->toBe('2026-10-04');

    expect(payoutBySettlement('st-a'))
        ->shop_id->toBe($shop->id)
        ->amount_minor->toBe(12_000)
        ->status->toBe(PayoutStatus::Settled)
        ->and(payoutBySettlement('st-a')->period->toDateString())->toBe('2026-10-01')
        ->and(payoutBySettlement('st-b')->status)->toBe(PayoutStatus::Pending)
        ->and(payoutBySettlement('st-c')->status)->toBe(PayoutStatus::Failed);
});

it('is idempotent', function (): void {
    $key = PayoutWorld::key();
    PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    $this->gateway->settlements[$key] = [
        PayoutWorld::record('st-a', $key, 12_000, 'paid', '2026-10-01'),
        PayoutWorld::record('st-b', $key, 8_000, 'pending', '2026-10-03'),
    ];

    syncNow();
    $second = syncNow();

    expect(Payout::query()->count())->toBe(2)
        ->and($second['created'])->toBe(0)
        ->and($second['updated'])->toBe(0);
});

it('moves a pending payout to settled when the provider paid it', function (): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-02', 7_000, settlementId: 'st-p');
    $this->gateway->settlements[$key] = [PayoutWorld::record('st-p', $key, 7_000, 'paid', '2026-10-02')];

    expect(syncNow()['updated'])->toBe(1)
        ->and(payoutBySettlement('st-p')->status)->toBe(PayoutStatus::Settled);
});

it('never downgrades a settled payout', function (string $providerStatus): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    PayoutWorld::payout($shop, PayoutStatus::Settled, '2026-10-02', 7_000, settlementId: 'st-s');
    $this->gateway->settlements[$key] = [PayoutWorld::record('st-s', $key, 1, $providerStatus, '2026-10-03')];

    syncNow();

    expect(payoutBySettlement('st-s'))
        ->status->toBe(PayoutStatus::Settled)
        ->amount_minor->toBe(7_000);
})->with(['pending', 'failed']);

it('never overwrites a held payout', function (): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    PayoutWorld::payout($shop, PayoutStatus::Held, '2026-10-02', 7_000, hold: true, settlementId: 'st-h');
    $this->gateway->settlements[$key] = [PayoutWorld::record('st-h', $key, 7_000, 'paid', '2026-10-02')];

    expect(syncNow()['protected'])->toBe(1)
        ->and(payoutBySettlement('st-h'))
        ->status->toBe(PayoutStatus::Held)
        ->hold->toBeTrue()
        ->hold_reason->toBe('fraud.redeem_rate');
});

it('starts a new pending payout on hold while the shop has an unreviewed fraud flag', function (): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    (new AbuseFlag)->forceFill(['shop_id' => $shop->id, 'kind' => 'redeem_rate', 'detail' => ['redemptions' => 40]])->save();
    $this->gateway->settlements[$key] = [
        PayoutWorld::record('st-new', $key, 9_000, 'pending', '2026-10-03'),
        PayoutWorld::record('st-paid', $key, 9_000, 'paid', '2026-10-01'),
    ];

    syncNow();

    expect(payoutBySettlement('st-new'))
        ->status->toBe(PayoutStatus::Held)
        ->hold->toBeTrue()
        ->hold_reason->toBe('fraud.redeem_rate')
        ->and(payoutBySettlement('st-paid')->hold)->toBeFalse();
});

it('puts a failed or pending payout on hold when it becomes pending after its shop was flagged', function (string $before): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    PayoutWorld::payout($shop, PayoutStatus::from($before), '2026-10-02', 7_000, settlementId: 'st-up');
    (new AbuseFlag)->forceFill(['shop_id' => $shop->id, 'kind' => 'redeem_rate', 'detail' => ['redemptions' => 40]])->save();
    $this->gateway->settlements[$key] = [PayoutWorld::record('st-up', $key, 7_500, 'pending', '2026-10-02')];

    syncNow();

    expect(payoutBySettlement('st-up'))
        ->status->toBe(PayoutStatus::Held)
        ->hold->toBeTrue()
        ->hold_reason->toBe('fraud.redeem_rate')
        ->amount_minor->toBe(7_500);
})->with(['pending', 'failed']);

it('locks the shop row before it reads the fraud flags or writes a payout', function (): void {
    $key = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    $this->gateway->settlements[$key] = [PayoutWorld::record('st-lock', $key, 9_000, 'pending', '2026-10-03')];
    $statements = [];
    DB::listen(function ($query) use (&$statements): void {
        $statements[] = $query->sql;
    });

    syncNow();

    $lock = collect($statements)->search(fn (string $sql): bool => str_contains($sql, 'from "shops"') && str_contains($sql, 'for update'));
    $flags = collect($statements)->search(fn (string $sql): bool => str_contains($sql, 'from "abuse_flags"'));
    $insert = collect($statements)->search(fn (string $sql): bool => str_starts_with($sql, 'insert into "payouts"'));

    expect($lock)->not->toBeFalse()
        ->and($lock)->toBeLessThan($flags)
        ->and($lock)->toBeLessThan($insert)
        ->and($shop->id)->not->toBe('');
});

it('rejects records of another sub-merchant, unknown statuses and foreign objects', function (): void {
    $key = PayoutWorld::key();
    PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    $this->gateway->settlements[$key] = [
        PayoutWorld::record('st-other', PayoutWorld::key(), 1_000, 'paid', '2026-10-01'),
        PayoutWorld::record('st-odd', $key, 1_000, 'refunded', '2026-10-01'),
        ['settlementId' => 'st-array', 'status' => 'paid'],
        PayoutWorld::record(str_repeat('x', 192), $key, 1_000, 'paid', '2026-10-01'),
        PayoutWorld::record('st-ok', $key, 1_000, 'paid', '2026-10-01'),
    ];

    $summary = syncNow();

    expect($summary['rejected'])->toBe(4)
        ->and($summary['created'])->toBe(1)
        ->and(Payout::query()->pluck('provider_settlement_id')->all())->toBe(['st-ok']);
});

it('rejects a provider record that is not TRY or has a negative amount at the DTO', function (): void {
    expect(fn () => PayoutWorld::record('st', 'k', -1, 'paid', '2026-10-01'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => new SettlementRecord('st', 'k', 1, 'EUR', 'paid', CarbonImmutable::now()))->toThrow(InvalidArgumentException::class);
});

it('continues with the other shops when the provider fails for one', function (): void {
    $down = PayoutWorld::key();
    $up = PayoutWorld::key();
    PayoutWorld::shopWithFinancials(subMerchantKey: $down);
    PayoutWorld::shopWithFinancials(subMerchantKey: $up);
    $this->gateway->settlements[$down] = new GatewayUnavailable;
    $this->gateway->settlements[$up] = [PayoutWorld::record('st-up', $up, 1_000, 'pending', '2026-10-03')];

    $summary = syncNow();

    expect($summary['failed_shops'])->toBe(1)
        ->and($summary['created'])->toBe(1);
});

it('runs from the command line', function (): void {
    $key = PayoutWorld::key();
    PayoutWorld::shopWithFinancials(subMerchantKey: $key);
    $this->gateway->settlements[$key] = [PayoutWorld::record('st-cli', $key, 1_000, 'pending', '2026-10-03')];

    $this->artisan('payouts:sync')->assertSuccessful();

    expect(Payout::query()->where('provider_settlement_id', 'st-cli')->exists())->toBeTrue();
});

it('schedules payouts.sync every six hours and fraud.scan hourly', function (): void {
    $events = collect(app(Schedule::class)->events())->keyBy('description');

    expect($events->get('payouts.sync')?->expression)->toBe('0 */6 * * *')
        ->and($events->get('payouts.sync')?->withoutOverlapping)->toBeTrue()
        ->and($events->get('fraud.scan')?->expression)->toBe('0 * * * *')
        ->and($events->get('fraud.scan')?->withoutOverlapping)->toBeTrue();
});

it('ignores shops without a key even when they are verified', function (): void {
    HookWorld::shop();

    expect(syncNow()['shops'])->toBe(0)
        ->and($this->gateway->settlementCalls)->toBe([]);
});
