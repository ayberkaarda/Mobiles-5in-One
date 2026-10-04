<?php

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payments\Services\CommissionCalculator;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Support\Payouts\PayoutWorld;

/*
| GET /api/v1/shops/{id}/payouts: per-day ledger for the shop owner (story 7). Staff
| 403, other merchants and unknown ids 404, no donor or recipient identifiers.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
});

function ledgerCall(string $shopId, ?string $token, string $query = ''): TestResponse
{
    app('auth')->forgetGuards();

    return test()->getJson("/api/v1/shops/{$shopId}/payouts{$query}", $token === null ? [] : ['Authorization' => 'Bearer '.$token]);
}

function ist(string $time): CarbonImmutable
{
    return CarbonImmutable::parse($time, 'Europe/Istanbul');
}

/**
 * Three days of activity for one shop plus noise that must not show up.
 *
 * @return array{shop: Shop, donors: list<User>}
 */
function ledgerWorld(): array
{
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    $donorA = HookWorld::donor();
    $donorB = HookWorld::donor();

    // 2026-10-04: two paid donations, one initiated, one failed (ignored).
    PayoutWorld::donation($item, $donorA, 10_000, 500, DonationStatus::Paid, ist('2026-10-04 09:00'));
    PayoutWorld::donation($item, $donorB, 3_001, 150, DonationStatus::Paid, ist('2026-10-04 10:00'));
    PayoutWorld::donation($item, $donorA, 9_999, 499, DonationStatus::Initiated, null);
    PayoutWorld::donation($item, $donorB, 9_999, 499, DonationStatus::Failed, null);
    // Istanbul day boundaries: 23:30 belongs to 10-03, 00:10 to 10-04.
    PayoutWorld::donation($item, $donorA, 2_000, 100, DonationStatus::Paid, ist('2026-10-03 23:30'));
    PayoutWorld::donation($item, $donorA, 1_000, 50, DonationStatus::Paid, ist('2026-10-04 00:10'));
    // Refunded donations are not paid any more.
    PayoutWorld::donation($item, $donorB, 4_000, 200, DonationStatus::Refunded, ist('2026-10-03 12:00'));

    PayoutWorld::redeemed($shop, [ist('2026-10-04 11:00'), ist('2026-10-04 11:05'), ist('2026-10-02 08:00')], by: HookWorld::owner($shop));

    PayoutWorld::payout($shop, PayoutStatus::Settled, '2026-10-02', 20_000);
    PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03', 5_000);
    PayoutWorld::payout($shop, PayoutStatus::Settled, '2026-10-03', 1_000);
    PayoutWorld::payout($shop, PayoutStatus::Held, '2026-10-01', 7_000, hold: true);

    // Another shop's activity.
    $other = HookWorld::shop();
    PayoutWorld::donation(HookWorld::item($other), $donorA, 50_000, 2_500, DonationStatus::Paid, ist('2026-10-04 09:30'));
    PayoutWorld::payout($other, PayoutStatus::Failed, '2026-10-04', 3_000);

    return ['shop' => $shop, 'donors' => [$donorA, $donorB]];
}

it('returns per-day rows with amounts, redemptions, settlement status and the commission rule', function (): void {
    ['shop' => $shop] = ledgerWorld();

    $response = ledgerCall($shop->id, HookWorld::userToken(HookWorld::owner($shop)));

    $response->assertOk();
    expect($response->json('data'))->toBe([
        ['date' => '2026-10-04', 'donated_minor' => 14_001, 'commission_minor' => 700, 'net_minor' => 13_301, 'redeemed_count' => 2, 'settlement' => ['status' => 'none', 'amount_minor' => null]],
        ['date' => '2026-10-03', 'donated_minor' => 2_000, 'commission_minor' => 100, 'net_minor' => 1_900, 'redeemed_count' => 0, 'settlement' => ['status' => 'pending', 'amount_minor' => 6_000]],
        ['date' => '2026-10-02', 'donated_minor' => 0, 'commission_minor' => 0, 'net_minor' => 0, 'redeemed_count' => 1, 'settlement' => ['status' => 'settled', 'amount_minor' => 20_000]],
        ['date' => '2026-10-01', 'donated_minor' => 0, 'commission_minor' => 0, 'net_minor' => 0, 'redeemed_count' => 0, 'settlement' => ['status' => 'held', 'amount_minor' => 7_000]],
    ])->and($response->json('meta'))->toBe([
        'currency' => 'TRY',
        'next_cursor' => null,
        'commission' => ['rate_bps' => 500, 'text_key' => 'payouts.commission.transparent'],
    ]);
});

it('shows the configured commission rate', function (): void {
    config(['payments.commission_bps' => 725]);
    app()->forgetInstance(CommissionCalculator::class);
    $shop = HookWorld::shop();

    expect(ledgerCall($shop->id, HookWorld::userToken(HookWorld::owner($shop)))->json('meta.commission.rate_bps'))->toBe(725);
});

it('reports a failed settlement over a pending one on the same day', function (): void {
    $shop = HookWorld::shop();
    PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03', 1_000);
    PayoutWorld::payout($shop, PayoutStatus::Failed, '2026-10-03', 2_000);

    expect(ledgerCall($shop->id, HookWorld::userToken(HookWorld::owner($shop)))->json('data.0.settlement'))
        ->toBe(['status' => 'failed', 'amount_minor' => 3_000]);
});

it('never exposes donor or recipient identifiers', function (): void {
    ['shop' => $shop, 'donors' => $donors] = ledgerWorld();

    $body = (string) ledgerCall($shop->id, HookWorld::userToken(HookWorld::owner($shop)))->getContent();

    foreach ($donors as $donor) {
        expect($body)->not->toContain($donor->id)->not->toContain($donor->email)->not->toContain($donor->name);
    }

    foreach (DB::table('donations')->pluck('id') as $id) {
        expect($body)->not->toContain((string) $id);
    }

    foreach (DB::table('hooks')->get(['id', 'code_hash', 'redeemed_by_user_id']) as $hook) {
        expect($body)->not->toContain((string) $hook->id)->not->toContain((string) $hook->code_hash)->not->toContain((string) $hook->redeemed_by_user_id);
    }

    expect($body)->not->toContain('donor')->not->toContain('anon');
});

it('pages by day with an opaque cursor', function (): void {
    ['shop' => $shop] = ledgerWorld();
    $token = HookWorld::userToken(HookWorld::owner($shop));

    $first = ledgerCall($shop->id, $token, '?limit=3');
    $cursor = $first->json('meta.next_cursor');
    $second = ledgerCall($shop->id, $token, '?limit=3&cursor='.$cursor);

    expect(array_column($first->json('data'), 'date'))->toBe(['2026-10-04', '2026-10-03', '2026-10-02'])
        ->and($cursor)->toBeString()
        ->and(array_column($second->json('data'), 'date'))->toBe(['2026-10-01'])
        ->and($second->json('meta.next_cursor'))->toBeNull();
});

it('refuses an invalid cursor or limit', function (string $query, string $field): void {
    $shop = HookWorld::shop();

    $response = ledgerCall($shop->id, HookWorld::userToken(HookWorld::owner($shop)), $query);

    $response->assertStatus(422);
    expect($response->json('code'))->toBe('validation.failed')
        ->and($response->json('errors.0.field'))->toBe($field);
})->with([
    'garbage cursor' => ['?cursor=not-a-cursor', 'cursor'],
    'bad date in cursor' => ['?cursor='.rtrim(strtr(base64_encode('{"before":"2026-13-40"}'), '+/', '-_'), '='), 'cursor'],
    'limit too high' => ['?limit=91', 'limit'],
    'limit zero' => ['?limit=0', 'limit'],
]);

it('answers staff with 403', function (): void {
    $shop = HookWorld::shop();
    $staff = HookWorld::staff($shop);

    $response = ledgerCall($shop->id, HookWorld::userToken($staff));

    $response->assertStatus(403);
    expect($response->json('code'))->toBe('forbidden');
});

it('answers another merchant and an unknown shop alike with 404', function (): void {
    $shop = HookWorld::shop();
    $stranger = HookWorld::owner(HookWorld::shop());
    $token = HookWorld::userToken($stranger);

    $foreign = ledgerCall($shop->id, $token);
    $missing = ledgerCall('00000000-0000-4000-8000-0000000000aa', $token);

    $foreign->assertNotFound();
    $missing->assertNotFound();
    expect($foreign->json('code'))->toBe('not_found')
        ->and(collect($foreign->json())->except('request_id')->all())->toBe(collect($missing->json())->except('request_id')->all());
});

it('answers a donor token with 403 and a guest with 401', function (): void {
    $shop = HookWorld::shop();

    ledgerCall($shop->id, HookWorld::userToken(HookWorld::donor()))->assertStatus(403);
    ledgerCall($shop->id, null)->assertStatus(401);
});

it('refuses an anon device token', function (): void {
    $shop = HookWorld::shop();

    ledgerCall($shop->id, HookWorld::anonToken(HookWorld::anon()))->assertStatus(401);
});

it('does not route a non-uuid shop id', function (): void {
    $shop = HookWorld::shop();

    ledgerCall('not-a-uuid', HookWorld::userToken(HookWorld::owner($shop)))->assertNotFound();
});

it('returns an empty ledger for a shop without activity', function (): void {
    $shop = HookWorld::shop();

    $response = ledgerCall($shop->id, HookWorld::userToken(HookWorld::owner($shop)));

    $response->assertOk();
    expect($response->json('data'))->toBe([])
        ->and($response->json('meta.next_cursor'))->toBeNull();
});
