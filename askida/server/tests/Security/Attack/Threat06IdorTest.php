<?php

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Donations\Models\Donation;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;
use Tests\Security\IdorHarness;
use Tests\Support\Payouts\PayoutWorld;

/*
| Threat 4.6, IDOR across donors, shops and anon ids, over the Phase 3 resources
| (donations, payouts, redemptions) and the anon device endpoints. A resource of another
| caller answers 404 `not_found` exactly like a missing id (also when the id is spelled in
| upper case), the body names nothing of the other party, and nothing changes. The
| Phase 1-2 shop, item and document routes are covered by tests/Security/IdorPhase2Test.php.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->harness = new IdorHarness($this);
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
});

function attack06Donation(User $donor): Donation
{
    return HookWorld::donation(HookWorld::item(HookWorld::shop()), $donor, qty: 2);
}

it('answers another donor\'s donation like a missing one, whatever the spelling of the id', function (string $spelling): void {
    $owner = HookWorld::donor();
    $intruder = HookWorld::donor();
    $donation = attack06Donation($owner);
    $id = $spelling === 'upper' ? strtoupper($donation->id) : $donation->id;

    $response = $this->harness->call('GET', "/api/v1/donations/{$id}", IdorHarness::bearer($intruder));
    $missing = $this->harness->call('GET', '/api/v1/donations/'.Str::uuid7(), IdorHarness::bearer($intruder, 'second'));

    AttackKit::assertProblem($response, 404, 'not_found');
    expect(array_diff_key((array) $response->json(), ['request_id' => 1]))->toBe(array_diff_key((array) $missing->json(), ['request_id' => 1]))
        ->and((string) $response->getContent())->not->toContain($donation->shop_id)->not->toContain((string) $owner->email);

    // Negative control: the owner reads it.
    $this->harness->call('GET', "/api/v1/donations/{$donation->id}", IdorHarness::bearer($owner))
        ->assertOk()->assertJsonPath('data.id', $donation->id);
})->with(['lower', 'upper']);

it('lists only the caller\'s donations and ignores a donor filter in the query', function (): void {
    $owner = HookWorld::donor();
    $intruder = HookWorld::donor();
    $foreign = attack06Donation($owner);
    $own = attack06Donation($intruder);

    $response = $this->harness->call('GET', "/api/v1/donations?donor_id={$owner->id}", IdorHarness::bearer($intruder));

    $response->assertOk();
    expect(array_column((array) $response->json('data'), 'id'))->toBe([$own->id])
        ->and((string) $response->getContent())->not->toContain($foreign->id);
});

it('keeps a shop\'s payout ledger from other owners (404), its staff (403) and donors (403)', function (): void {
    $shop = HookWorld::shop();
    PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-04', amount: 12_345);
    $owner = HookWorld::owner($shop);
    $staff = HookWorld::staff($shop);
    $otherOwner = HookWorld::owner(HookWorld::shop());
    $uri = "/api/v1/shops/{$shop->id}/payouts";

    $foreign = $this->harness->call('GET', $uri, IdorHarness::bearer($otherOwner));
    AttackKit::assertProblem($foreign, 404, 'not_found');
    expect((string) $foreign->getContent())->not->toContain('12345')->not->toContain($shop->name);

    AttackKit::assertProblem($this->harness->call('GET', strtoupper($uri), IdorHarness::bearer($otherOwner, 'upper')), 404, 'not_found');
    AttackKit::assertProblem($this->harness->call('GET', $uri, IdorHarness::bearer($staff)), 403, 'forbidden');
    AttackKit::assertProblem($this->harness->call('GET', $uri, IdorHarness::bearer(HookWorld::donor())), 403, 'forbidden');

    // Negative control: the owner reads the ledger.
    expect($this->harness->call('GET', $uri, IdorHarness::bearer($owner))->status())->toBe(200);
});

it('keeps redemptions of shop A from the owner of shop B', function (): void {
    $this->harness->assertRouteIsolated(
        'GET',
        '/api/v1/shops/{shop}/redemptions',
        fn (User $owner): Shop => HookWorld::shop(owner: $owner),
        HookWorld::merchant(),
        HookWorld::merchant(),
    );
});

it('refuses an anon device token on every donor and merchant resource', function (string $method, string $uri): void {
    $device = HookWorld::anon();
    $donation = attack06Donation(HookWorld::donor());
    $uri = strtr($uri, ['{donation}' => $donation->id, '{shop}' => $donation->shop_id]);

    AttackKit::assertProblem($this->harness->call($method, $uri, HookWorld::anonToken($device)), 401, 'auth.unauthenticated');
})->with([
    ['GET', '/api/v1/donations'],
    ['GET', '/api/v1/donations/{donation}'],
    ['GET', '/api/v1/shops/{shop}/payouts'],
    ['GET', '/api/v1/shops/{shop}/redemptions'],
    ['GET', '/api/v1/me'],
]);

it('deletes only the calling anon device, whatever id the body names', function (): void {
    $victim = HookWorld::anon();
    $attacker = HookWorld::anon();

    $response = $this->harness->call('DELETE', '/api/v1/anon/me', HookWorld::anonToken($attacker), ['anon_id' => $victim->anon_id]);

    expect($response->status())->toBeLessThan(300)
        ->and(AnonDevice::query()->where('anon_id', $victim->anon_id)->exists())->toBeTrue()
        ->and(AnonDevice::query()->where('anon_id', $attacker->anon_id)->exists())->toBeFalse()
        ->and((string) $response->getContent())->not->toContain($victim->anon_id);
});
