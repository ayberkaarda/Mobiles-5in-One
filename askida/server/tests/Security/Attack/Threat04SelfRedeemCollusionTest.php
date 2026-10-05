<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Fraud\Mail\PayoutHoldAlertMail;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Fraud\Services\FraudScanner;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;
use Tests\Support\Payouts\PayoutWorld;

/*
| Threat 4.4, merchant self-redeem collusion. A merchant account cannot donate or change
| its kind; a redemption of a unit paid by the redeeming account is recorded as
| `suspicious_self_redeem` (ids only); above the configured maximum the fraud scan holds
| the shop's pending payouts, flags the shop (counts only) and alerts finance.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    Mail::fake();
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
    config([
        'payments.fraud.max_suspicious_self_redeems' => 3,
        'payments.fraud.max_redeems_per_hour' => 30,
        'payments.finance_alert_email' => 'finance-alerts@example.test',
    ]);
});

/**
 * Redeems, through the API and as the given merchant, `count` units that were paid by
 * the given account. Returns the redeemed hook ids.
 *
 * @return list<string>
 */
function attack04RedeemPaidBy(Shop $shop, User $merchant, User $payer, int $count): array
{
    $item = HookWorld::item($shop);
    $token = HookWorld::userToken($merchant, 'collusion-device');
    $ids = [];

    foreach (HookWorld::availableHooks($item, $count, $payer) as $hook) {
        $code = HookWorld::newCode();
        HookWorld::reserve($hook, HookWorld::anon(), $code);
        AttackKit::json('POST', "/api/v1/shops/{$shop->id}/redeem", $token, ['code' => $code])->assertOk();
        $ids[] = $hook->id;
    }

    return $ids;
}

it('refuses a donation from a merchant account and from a shop staff member', function (): void {
    PaymentWorld::useFakeGateway();
    $shop = PaymentWorld::payableShop();
    $item = PaymentWorld::item($shop);
    $owner = HookWorld::owner($shop);
    $staff = HookWorld::staff($shop);

    foreach ([$owner, $staff] as $merchant) {
        $response = AttackKit::json('POST', '/api/v1/donations', HookWorld::userToken($merchant, 'donate-device'), [
            'shop_id' => $shop->id, 'item_id' => $item->id, 'qty' => 1,
        ]);
        AttackKit::assertProblem($response, 403, 'forbidden');
    }

    expect(Donation::query()->where('shop_id', $shop->id)->count())->toBe(0);

    // Negative control: a donor account starts the same donation.
    AttackKit::json('POST', '/api/v1/donations', PaymentWorld::token(PaymentWorld::donor()), [
        'shop_id' => $shop->id, 'item_id' => $item->id, 'qty' => 1,
    ])->assertCreated();
    expect(Donation::query()->where('shop_id', $shop->id)->count())->toBe(1);
});

it('does not let a merchant turn itself into a donor', function (): void {
    $merchant = HookWorld::merchant();

    $response = AttackKit::json('PATCH', '/api/v1/me', HookWorld::userToken($merchant), ['kind' => 'donor']);

    AttackKit::assertProblem($response, 422, 'validation.failed');
    expect(AttackKit::errorPairs($response))->toBe(['kind:prohibited'])
        ->and($merchant->fresh()?->kind->value)->toBe('merchant');
});

it('records a redemption of a unit paid by the redeeming account with ids only', function (): void {
    $shop = HookWorld::shop();
    $owner = HookWorld::owner($shop);

    [$hookId] = attack04RedeemPaidBy($shop, $owner, $owner, 1);

    $entry = Activity::query()->where('event', 'suspicious_self_redeem')->sole();
    expect($entry->subject_id)->toBe($hookId)
        ->and($entry->causer_id)->toBe($owner->id)
        ->and(array_keys($entry->properties->all()))->toBe(['shop_id', 'donation_id'])
        ->and($entry->properties['shop_id'])->toBe($shop->id);

    // Negative control: a unit paid by somebody else leaves no entry.
    attack04RedeemPaidBy($shop, $owner, HookWorld::donor(), 1);
    expect(Activity::query()->where('event', 'suspicious_self_redeem')->count())->toBe(1);
});

it('holds the pending payouts and alerts finance once the self-redemptions exceed the maximum', function (): void {
    $shop = HookWorld::shop();
    $owner = HookWorld::owner($shop);
    $pending = PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-04');
    $settled = PayoutWorld::payout($shop, PayoutStatus::Settled, '2026-10-03');
    $bystander = HookWorld::shop();
    $bystanderPending = PayoutWorld::payout($bystander, PayoutStatus::Pending, '2026-10-04');

    attack04RedeemPaidBy($shop, $owner, $owner, 3);
    // The scan window ends just before "now" (exclusive), so the clock moves on a minute.
    $this->travel(1)->minutes();
    app(FraudScanner::class)->scan();

    // At the maximum: nothing happens yet.
    expect($pending->refresh()->hold)->toBeFalse()
        ->and(AbuseFlag::query()->count())->toBe(0);
    Mail::assertNothingQueued();

    attack04RedeemPaidBy($shop, $owner, $owner, 1);
    $this->travel(1)->minutes();
    $summary = app(FraudScanner::class)->scan();

    $flag = AbuseFlag::query()->where('shop_id', $shop->id)->sole();
    expect($summary['held_payouts'])->toBe(1)
        ->and($flag->getRawOriginal('kind'))->toBe('self_redeem_count')
        ->and($pending->refresh()->hold)->toBeTrue()
        ->and($pending->hold_reason)->not->toBeNull()
        ->and($settled->refresh()->hold)->toBeFalse()
        ->and($bystanderPending->refresh()->hold)->toBeFalse();
    Mail::assertQueued(PayoutHoldAlertMail::class, fn (PayoutHoldAlertMail $mail): bool => $mail->hasTo('finance-alerts@example.test'));
    Mail::assertQueuedCount(1);

    // A second scan in the same window raises no second flag or mail.
    app(FraudScanner::class)->scan();
    expect(AbuseFlag::query()->where('shop_id', $shop->id)->count())->toBe(1);
    Mail::assertQueuedCount(1);

    expect(Hook::query()->where('shop_id', $shop->id)->where('status', HookStatus::Redeemed->value)->count())->toBe(4);
});
