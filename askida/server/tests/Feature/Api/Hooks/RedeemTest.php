<?php

use App\Domain\Hooks\Events\HookRedeemed;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| POST /api/v1/shops/{shop}/redeem (story 6, security items 4 and 6): server-side code
| check, exactly one transition to REDEEMED, opaque failures, no recipient data.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
});

function redeemCall(Shop|string $shop, ?string $token, mixed $code): TestResponse
{
    app('auth')->forgetGuards();
    $id = $shop instanceof Shop ? $shop->id : $shop;

    return test()->postJson("/api/v1/shops/{$id}/redeem", ['code' => $code], $token === null ? [] : ['Authorization' => 'Bearer '.$token]);
}

/**
 * @return array{0: Shop, 1: Hook, 2: string}
 */
function reservedUnit(int $minutes = 10, ?CarbonImmutable $reservedAt = null): array
{
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$hook] = HookWorld::availableHooks($item, 1);
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, HookWorld::anon(), $code, $reservedAt, $minutes);

    return [$shop, $hook, $code];
}

it('redeems a reserved code once and answers with the item only', function (): void {
    [$shop, $hook, $code] = reservedUnit();
    $owner = HookWorld::owner($shop);
    $anonId = $hook->fresh()?->anon_id;

    $response = redeemCall($shop, HookWorld::userToken($owner), $code);

    $response->assertOk();
    expect(array_keys($response->json()))->toBe(['message', 'item', 'redeemed_at'])
        ->and($response->json('message'))->toBe('1 ekmek verildi')
        ->and($response->json('item'))->toBe(['name' => 'Ekmek'])
        ->and(CarbonImmutable::parse($response->json('redeemed_at'))->equalTo(CarbonImmutable::now()))->toBeTrue()
        ->and($response->getContent())->not->toContain((string) $anonId)
        ->not->toContain($code)
        ->not->toContain(HookWorld::hash($code))
        ->not->toContain($hook->id);

    $fresh = $hook->fresh();
    expect($fresh?->status)->toBe(HookStatus::Redeemed)
        ->and($fresh?->redeemed_by_user_id)->toBe($owner->id)
        ->and($fresh?->redeemed_at?->equalTo(CarbonImmutable::now()))->toBeTrue();

    $again = redeemCall($shop, HookWorld::userToken($owner, 'second-device'), $code);
    $again->assertStatus(422);
    expect($again->json('code'))->toBe('hook.code_invalid');
});

it('lets staff redeem and normalises typed codes', function (): void {
    [$shop, $hook, $code] = reservedUnit();
    $typed = ' '.strtolower(substr($code, 0, 4)).'-'.substr($code, 4).' ';

    redeemCall($shop, HookWorld::userToken(HookWorld::staff($shop)), $typed)->assertOk();

    expect($hook->fresh()?->status)->toBe(HookStatus::Redeemed);
});

it('answers unknown, used and foreign codes with the same opaque problem', function (): void {
    [$shop, , $code] = reservedUnit();
    [$otherShop, , $otherCode] = reservedUnit();
    $token = HookWorld::userToken(HookWorld::owner($shop));

    $unknown = redeemCall($shop, $token, HookWorld::newCode());
    $foreign = redeemCall($shop, $token, $otherCode);
    redeemCall($shop, $token, $code)->assertOk();
    $used = redeemCall($shop, $token, $code);

    foreach ([$unknown, $foreign, $used] as $response) {
        $response->assertStatus(422);
        expect($response->json('code'))->toBe('hook.code_invalid')
            ->and(array_keys($response->json()))->toBe(['type', 'title', 'status', 'code', 'request_id']);
    }

    expect(DB::table('hooks')->where('shop_id', $otherShop->id)->value('status'))->toBe('RESERVED');
});

it('answers an expired code with hook.code_expired and returns the unit to the pool', function (): void {
    [$shop, $hook, $code] = reservedUnit(reservedAt: CarbonImmutable::now()->subMinutes(11));
    $token = HookWorld::userToken(HookWorld::owner($shop));

    $response = redeemCall($shop, $token, $code);

    $response->assertStatus(422);
    expect($response->json('code'))->toBe('hook.code_expired');

    $fresh = $hook->fresh();
    expect($fresh?->status)->toBe(HookStatus::Available)
        ->and($fresh?->anon_id)->toBeNull()
        ->and($fresh?->code_hash)->toBeNull()
        ->and($fresh?->reserved_at)->toBeNull()
        ->and($fresh?->expires_at)->toBeNull();

    expect(redeemCall($shop, $token, $code)->json('code'))->toBe('hook.code_invalid');
});

it('treats the exact deadline as expired', function (): void {
    [$shop, $hook, $code] = reservedUnit();
    $this->travel(10)->minutes();

    expect(redeemCall($shop, HookWorld::userToken(HookWorld::owner($shop)), $code)->json('code'))->toBe('hook.code_expired')
        ->and($hook->fresh()?->status)->toBe(HookStatus::Available);
});

it('validates the code format before any lookup', function (mixed $code, string $rule): void {
    [$shop] = reservedUnit();

    $response = redeemCall($shop, HookWorld::userToken(HookWorld::owner($shop)), $code);

    $response->assertStatus(422);
    expect($response->json('code'))->toBe('validation.failed')
        ->and($response->json('errors'))->toBe([['field' => 'code', 'code' => $rule]]);
})->with([
    'too short' => ['ABC123', 'regex'],
    'letter U' => ['ABCDEFGU', 'regex'],
    'missing' => [null, 'required'],
    'not a string' => [12345678, 'string'],
]);

it('keeps redemption inside the shop: outsiders 404, other kinds 403, anon and guests 401', function (): void {
    [$shop, $hook, $code] = reservedUnit();
    $outsider = HookWorld::merchant();
    HookWorld::shop(owner: $outsider);

    $notMember = redeemCall($shop, HookWorld::userToken($outsider), $code);
    $notMember->assertNotFound();
    expect($notMember->json('code'))->toBe('not_found');

    expect(redeemCall($shop, HookWorld::userToken(HookWorld::donor()), $code)->json('code'))->toBe('forbidden')
        ->and(redeemCall($shop, HookWorld::anonToken(HookWorld::anon()), $code)->json('code'))->toBe('auth.unauthenticated')
        ->and(redeemCall($shop, null, $code)->status())->toBe(401)
        ->and(redeemCall((string) Str::uuid7(), HookWorld::userToken($outsider, 'other'), $code)->status())->toBe(404)
        ->and(redeemCall('not-a-uuid', HookWorld::userToken($outsider, 'third'), $code)->status())->toBe(404)
        ->and($hook->fresh()?->status)->toBe(HookStatus::Reserved);
});

it('flags a merchant redeeming a unit paid by the same account', function (): void {
    $shop = HookWorld::shop();
    $owner = HookWorld::owner($shop);
    $item = HookWorld::item($shop);
    [$hook] = HookWorld::availableHooks($item, 1, donor: $owner);
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, HookWorld::anon(), $code);

    redeemCall($shop, HookWorld::userToken($owner), $code)->assertOk();

    $entry = DB::table('activity_log')->where('event', 'suspicious_self_redeem')->first();
    expect($entry)->not->toBeNull()
        ->and($entry->subject_id)->toBe($hook->id)
        ->and($entry->causer_id)->toBe($owner->id)
        ->and(json_decode((string) $entry->properties, true))->toBe(['shop_id' => $shop->id, 'donation_id' => $hook->donation_id]);
});

it('does not flag an ordinary redemption', function (): void {
    [$shop, , $code] = reservedUnit();

    redeemCall($shop, HookWorld::userToken(HookWorld::owner($shop)), $code)->assertOk();

    expect(DB::table('activity_log')->where('event', 'suspicious_self_redeem')->count())->toBe(0);
});

it('announces the redemption with ids only', function (): void {
    Event::fake([HookRedeemed::class]);
    [$shop, $hook, $code] = reservedUnit();

    redeemCall($shop, HookWorld::userToken(HookWorld::owner($shop)), $code)->assertOk();

    Event::assertDispatchedTimes(HookRedeemed::class, 1);
    Event::assertDispatched(HookRedeemed::class, fn (HookRedeemed $event): bool => $event->hookId === $hook->id
        && array_keys(get_object_vars($event)) === ['hookId', 'donationId', 'shopId', 'itemId']);
});

it('never writes the code to the log', function (): void {
    [$shop, , $code] = reservedUnit();
    $lines = [];
    Log::listen(function (MessageLogged $event) use (&$lines): void {
        $lines[] = $event->message.' '.json_encode($event->context);
    });

    redeemCall($shop, HookWorld::userToken(HookWorld::owner($shop)), $code)->assertOk();
    redeemCall($shop, HookWorld::userToken(HookWorld::owner($shop), 'again'), $code)->assertStatus(422);

    expect($lines)->not->toBeEmpty()
        ->and(implode("\n", $lines))->not->toContain($code)->not->toContain(HookWorld::hash($code));
});

it('limits redeem calls per shop for its members, not for outsiders', function (): void {
    config(['askida.limits.redeem_per_minute_shop' => 2]);
    [$shop] = reservedUnit();
    $ownerToken = HookWorld::userToken(HookWorld::owner($shop));
    $staffToken = HookWorld::userToken(HookWorld::staff($shop));
    $outsiderToken = HookWorld::userToken(HookWorld::merchant());

    // Outsiders burn only their own bucket.
    redeemCall($shop, $outsiderToken, HookWorld::newCode())->assertNotFound();
    redeemCall($shop, $outsiderToken, HookWorld::newCode())->assertNotFound();
    redeemCall($shop, $outsiderToken, HookWorld::newCode())->assertStatus(429);

    redeemCall($shop, $ownerToken, HookWorld::newCode())->assertStatus(422);
    redeemCall($shop, $staffToken, HookWorld::newCode())->assertStatus(422);

    $limited = redeemCall($shop, $ownerToken, HookWorld::newCode());
    $limited->assertStatus(429);
    expect($limited->json('code'))->toBe('rate_limited')
        ->and($limited->headers->get('Retry-After'))->not->toBeNull();
});
