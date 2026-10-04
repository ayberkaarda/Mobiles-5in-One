<?php

use App\Domain\Fraud\Mail\PayoutHoldAlertMail;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Fraud\Services\FraudScanner;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Support\Payouts\PayoutWorld;

/*
| fraud.scan (spec item 22): redemptions and self-redemptions of the last hour per
| verified shop against the configured maxima; above a maximum the shop's pending
| payouts are held, finance is flagged (counts only) and alerted by mail.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Mail::fake();
    $this->now = CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul');
    $this->travelTo($this->now);
    config([
        'payments.fraud.max_redeems_per_hour' => 30,
        'payments.fraud.max_self_redeem_ratio' => 0.5,
        'payments.fraud.max_suspicious_self_redeems' => 3,
        'payments.finance_alert_email' => 'finance-alerts@example.test',
    ]);
});

function scanNow(): array
{
    return app(FraudScanner::class)->scan();
}

function minutesAgo(int $minutes): CarbonImmutable
{
    return test()->now->subMinutes($minutes);
}

/**
 * @return list<string>
 */
function flagKinds(Shop $shop): array
{
    return AbuseFlag::query()->where('shop_id', $shop->id)->orderBy('kind')->pluck('kind')->all();
}

it('does not flag a shop at exactly the redemption maximum', function (): void {
    $shop = HookWorld::shop();
    $payout = PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03');
    PayoutWorld::redeemed($shop, minutesAgo(10), 30);

    scanNow();

    expect(flagKinds($shop))->toBe([])
        ->and($payout->refresh()->hold)->toBeFalse();
    Mail::assertNothingQueued();
});

it('locks the shop row before it holds payouts', function (): void {
    $shop = HookWorld::shop();
    PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03');
    PayoutWorld::redeemed($shop, minutesAgo(10), 31);
    $statements = [];
    DB::listen(function ($query) use (&$statements): void {
        $statements[] = $query->sql;
    });

    scanNow();

    $lock = collect($statements)->search(fn (string $sql): bool => str_contains($sql, 'from "shops"') && str_contains($sql, 'for update'));
    $hold = collect($statements)->search(fn (string $sql): bool => str_starts_with($sql, 'update "payouts"'));

    expect($lock)->not->toBeFalse()
        ->and($hold)->not->toBeFalse()
        ->and($lock)->toBeLessThan($hold);
});

it('holds the pending payouts, flags and alerts one redemption above the maximum', function (): void {
    $shop = HookWorld::shop();
    $pending = PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03');
    $settled = PayoutWorld::payout($shop, PayoutStatus::Settled, '2026-10-02');
    $failed = PayoutWorld::payout($shop, PayoutStatus::Failed, '2026-10-01');
    $otherShopPending = PayoutWorld::payout(HookWorld::shop(), PayoutStatus::Pending, '2026-10-03');
    PayoutWorld::redeemed($shop, minutesAgo(10), 31);

    $summary = scanNow();

    expect($summary)->toBe(['shops' => 1, 'flagged' => 1, 'held_payouts' => 1])
        ->and($pending->refresh())
        ->hold->toBeTrue()
        ->status->toBe(PayoutStatus::Held)
        ->hold_reason->toBe('fraud.redeem_rate')
        ->and($settled->refresh()->hold)->toBeFalse()
        ->and($settled->status)->toBe(PayoutStatus::Settled)
        ->and($failed->refresh()->hold)->toBeFalse()
        ->and($otherShopPending->refresh()->hold)->toBeFalse();

    $flag = AbuseFlag::query()->where('shop_id', $shop->id)->sole();
    expect($flag->kind)->toBe('redeem_rate')
        ->and($flag->detail)->toEqual([
            'window_minutes' => 60,
            'redemptions' => 31,
            'suspicious_self_redeems' => 0,
            'threshold' => 30,
            'held_payouts' => 1,
        ])
        ->and(DB::table('activity_log')->where('log_name', 'fraud')->where('event', 'fraud.flagged')->where('subject_id', $shop->id)->count())->toBe(1)
        ->and(DB::table('activity_log')->where('log_name', 'payouts')->where('event', 'payout.held')->where('subject_id', $shop->id)->count())->toBe(1);

    Mail::assertQueued(PayoutHoldAlertMail::class, fn (PayoutHoldAlertMail $mail): bool => $mail->hasTo('finance-alerts@example.test')
        && $mail->shopId === $shop->id
        && $mail->kind === 'redeem_rate');
    Mail::assertQueuedCount(1);
});

it('counts only the last hour', function (): void {
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(61), 20);
    PayoutWorld::redeemed($shop, minutesAgo(60), 1); // exactly at the window start: inside
    PayoutWorld::redeemed($shop, minutesAgo(30), 30);

    scanNow();

    expect(AbuseFlag::query()->where('shop_id', $shop->id)->value('detail'))->toMatchArray(['redemptions' => 31]);
});

it('does not flag a self-redemption share at exactly the maximum ratio', function (): void {
    config(['payments.fraud.max_suspicious_self_redeems' => 100]);
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(5), 4);
    PayoutWorld::selfRedeems($shop, 2, minutesAgo(5));

    scanNow();

    expect(flagKinds($shop))->toBe([]);
});

it('flags a self-redemption share above the maximum ratio', function (): void {
    config(['payments.fraud.max_suspicious_self_redeems' => 100]);
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(5), 5);
    PayoutWorld::selfRedeems($shop, 3, minutesAgo(5));

    scanNow();

    expect(flagKinds($shop))->toBe(['self_redeem_ratio'])
        ->and(AbuseFlag::query()->where('shop_id', $shop->id)->value('detail'))->toMatchArray([
            'redemptions' => 5,
            'suspicious_self_redeems' => 3,
            'threshold' => 0.5,
        ]);
});

it('keeps an exact decimal boundary exact (0.29 of 100)', function (): void {
    config(['payments.fraud.max_self_redeem_ratio' => 0.29]);

    expect(app(FraudScanner::class)->exceeded(100, 29))->not->toHaveKey('self_redeem_ratio')
        ->and(app(FraudScanner::class)->exceeded(100, 30))->toHaveKey('self_redeem_ratio');
});

it('does not flag exactly the maximum number of self-redemptions', function (): void {
    config(['payments.fraud.max_self_redeem_ratio' => 1.0]);
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(5), 3);
    PayoutWorld::selfRedeems($shop, 3, minutesAgo(5));

    scanNow();

    expect(flagKinds($shop))->toBe([]);
});

it('flags one self-redemption above the maximum count', function (): void {
    config(['payments.fraud.max_self_redeem_ratio' => 1.0]);
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(5), 4);
    PayoutWorld::selfRedeems($shop, 4, minutesAgo(5));
    PayoutWorld::selfRedeems(HookWorld::shop(), 9, minutesAgo(90)); // another shop, too old

    scanNow();

    expect(flagKinds($shop))->toBe(['self_redeem_count']);
});

it('ignores self-redemption entries older than an hour', function (): void {
    config(['payments.fraud.max_self_redeem_ratio' => 1.0]);
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(5), 4);
    PayoutWorld::selfRedeems($shop, 4, minutesAgo(61));

    scanNow();

    expect(flagKinds($shop))->toBe([]);
});

it('raises one flag and one mail per shop and kind while the flag is unreviewed', function (): void {
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(10), 31);

    scanNow();
    $late = PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-04');
    scanNow();

    expect(AbuseFlag::query()->where('shop_id', $shop->id)->count())->toBe(1)
        ->and($late->refresh()->hold)->toBeTrue();
    Mail::assertQueuedCount(1);

    AbuseFlag::query()->where('shop_id', $shop->id)->update(['reviewed_at' => now()]);
    scanNow();

    expect(AbuseFlag::query()->where('shop_id', $shop->id)->count())->toBe(2);
    Mail::assertQueuedCount(2);
});

it('skips shops that are not verified', function (): void {
    $shop = HookWorld::shop(verified: false);
    PayoutWorld::redeemed($shop, minutesAgo(10), 40);

    expect(scanNow()['shops'])->toBe(0)
        ->and(flagKinds($shop))->toBe([]);
});

it('writes counts only into the flag, the log and the mail', function (): void {
    $shop = HookWorld::shop();
    $merchant = HookWorld::owner($shop);
    PayoutWorld::redeemed($shop, minutesAgo(10), 31, $merchant);

    scanNow();

    $flagJson = (string) json_encode(AbuseFlag::query()->where('shop_id', $shop->id)->sole()->detail);
    $logJson = (string) DB::table('activity_log')->where('log_name', 'fraud')->value('properties');
    $mailText = '';
    Mail::assertQueued(PayoutHoldAlertMail::class, function (PayoutHoldAlertMail $mail) use (&$mailText): bool {
        $mailText = $mail->render();

        return true;
    });

    foreach ([$flagJson, $logJson, $mailText] as $haystack) {
        expect($haystack)->not->toContain($merchant->email)->not->toContain($merchant->id)->not->toContain($shop->name);
    }

    expect($mailText)->toContain($shop->id)->toContain('redeem_rate');
});

it('runs from the command line', function (): void {
    $shop = HookWorld::shop();
    PayoutWorld::redeemed($shop, minutesAgo(10), 31);

    $this->artisan('fraud:scan')->assertSuccessful();

    expect(flagKinds($shop))->toBe(['redeem_rate']);
});

it('leaves held payouts with their first reason when another kind triggers', function (): void {
    config(['payments.fraud.max_suspicious_self_redeems' => 100]);
    $shop = HookWorld::shop();
    $payout = PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03');
    PayoutWorld::redeemed($shop, minutesAgo(10), 31);
    PayoutWorld::selfRedeems($shop, 20, minutesAgo(10));

    scanNow();

    expect(flagKinds($shop))->toBe(['redeem_rate', 'self_redeem_ratio'])
        ->and($payout->refresh()->hold_reason)->toBe('fraud.redeem_rate')
        ->and(Payout::query()->where('shop_id', $shop->id)->where('hold', true)->count())->toBe(1);
});
