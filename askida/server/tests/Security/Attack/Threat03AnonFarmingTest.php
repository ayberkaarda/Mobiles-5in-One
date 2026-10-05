<?php

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;
use Tests\Security\Concurrency\ConcurrencyHarness;

/*
| Threat 4.3, anon farming. What the server can enforce without real attestation verdicts
| (ADR-0006): the attest limiter (3 a day per device key), caps bound to the anon id that
| survive a re-attestation, one success when one anon id reserves in parallel (separate OS
| processes through the HTTP stack), and the per-address reserve limiter that bounds a farm
| of anon ids behind one address. Real device farms and provider verdicts: not exercised.
| (No RefreshDatabase: the parallel test needs committed fixtures; every test removes what
| it created by id in afterEach.)
*/

beforeEach(function (): void {
    ConcurrencyHarness::ensureSchema();
    HookWorld::pepper();
    config(['askida.attestation.driver' => 'fake']);
    $this->shops = [];
    $this->anons = [];
    $this->knownAnons = AnonDevice::query()->pluck('anon_id')->all();
});

afterEach(function (): void {
    // Devices made by anon/attest during the test, found by id difference.
    $created = AnonDevice::query()->whereNotIn('anon_id', $this->knownAnons)->pluck('anon_id')->all();
    ConcurrencyHarness::cleanup($this->shops, array_values(array_unique([...$this->anons, ...$created])));
});

afterAll(function (): void {
    ConcurrencyHarness::shutdown();
});

/**
 * @return array{0: Shop, 1: Item}
 */
function attack03Shop(object $test, int $units = 1): array
{
    $shop = HookWorld::shop();
    $test->shops[] = $shop->id;
    $item = HookWorld::item($shop);
    HookWorld::availableHooks($item, $units);

    return [$shop, $item];
}

function attack03Attest(string $nonce, string $ip = '198.51.100.20'): TestResponse
{
    return AttackKit::json('POST', '/api/v1/anon/attest', null, [
        'platform' => 'android',
        'token' => 'attest-'.Str::random(24),
        'device_nonce' => $nonce,
    ], ip: $ip);
}

function attack03Reserve(string $token, Shop $shop, Item $item, string $ip = '198.51.100.20'): TestResponse
{
    return AttackKit::json('POST', '/api/v1/hooks/reserve', $token, ['shop_id' => $shop->id, 'item_id' => $item->id], ip: $ip);
}

function attack03Nonce(): string
{
    return Str::random(32);
}

it('allows 3 attestations a day per device key, refuses the 4th without issuing anything, and resets the next day', function (): void {
    $nonce = attack03Nonce();

    for ($i = 0; $i < 3; $i++) {
        attack03Attest($nonce)->assertOk()->assertJsonPath('abilities', ['anon']);
    }

    $device = AnonDevice::query()->whereNotIn('anon_id', $this->knownAnons)->sole();
    $tokensBefore = DB::table('personal_access_tokens')->where('tokenable_id', $device->id)->pluck('id')->all();

    $refused = attack03Attest($nonce);
    AttackKit::assertProblem($refused, 429, 'rate_limited');
    expect($refused->headers->get('Retry-After'))->not->toBeNull()
        ->and($refused->json('token'))->toBeNull()
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $device->id)->pluck('id')->all())->toBe($tokensBefore)
        ->and(AnonDevice::query()->whereNotIn('anon_id', $this->knownAnons)->count())->toBe(1);

    // A spoofed forwarded address does not open a new bucket (no trusted proxy).
    AttackKit::assertProblem(
        AttackKit::json('POST', '/api/v1/anon/attest', null, ['platform' => 'android', 'token' => 'attest-x', 'device_nonce' => $nonce], ['X-Forwarded-For' => '203.0.113.99'], ip: '198.51.100.20'),
        429,
        'rate_limited',
    );

    // Negative controls: another install is not affected, and the same one passes the next day.
    attack03Attest(attack03Nonce())->assertOk();
    $this->travel(1)->days();
    $this->travel(1)->minutes();
    attack03Attest($nonce)->assertOk();
});

it('keeps the caps on the anon id when the same install attests again for a fresh token', function (): void {
    [$shopA, $itemA] = attack03Shop($this, 2);
    [$shopB, $itemB] = attack03Shop($this);
    [$shopC, $itemC] = attack03Shop($this);
    $nonce = attack03Nonce();

    $first = (string) attack03Attest($nonce)->assertOk()->json('token');
    attack03Reserve($first, $shopA, $itemA)->assertCreated();

    $second = (string) attack03Attest($nonce)->assertOk()->json('token');
    expect($second)->not->toBe($first);

    // The old token is revoked; the new one belongs to the same anon id, so its caps hold.
    AttackKit::assertProblem(attack03Reserve($first, $shopB, $itemB), 401, 'auth.unauthenticated');
    AttackKit::assertProblem(attack03Reserve($second, $shopA, $itemA), 409, 'anon.shop_cap');
    attack03Reserve($second, $shopB, $itemB)->assertCreated();
    AttackKit::assertProblem(attack03Reserve($second, $shopC, $itemC), 409, 'anon.daily_cap');

    $anonId = AnonDevice::query()->whereNotIn('anon_id', $this->knownAnons)->sole()->anon_id;
    expect(Hook::query()->where('anon_id', $anonId)->where('status', HookStatus::Reserved->value)->count())->toBe(2)
        ->and(AnonDailyCounter::query()->where('anon_id', $anonId)->value('count'))->toBe(2)
        ->and(Hook::query()->where('shop_id', $shopC->id)->where('status', HookStatus::Available->value)->count())->toBe(1);
});

it('lets one anon id win once when it reserves in 8 parallel requests', function (): void {
    $workers = 8;
    [$shop, $item] = attack03Shop($this, $workers);
    $device = HookWorld::anon();
    $this->anons[] = $device->anon_id;
    $token = HookWorld::anonToken($device);

    $results = ConcurrencyHarness::run(array_fill(0, $workers, ['scenario' => 'http', 'args' => [
        'method' => 'POST',
        'uri' => '/api/v1/hooks/reserve',
        'token' => $token,
        'body' => json_encode(['shop_id' => $shop->id, 'item_id' => $item->id], JSON_THROW_ON_ERROR),
    ]]), $workers);

    expect(AttackKit::tally($results))->toBe(['201 ok' => 1, '409 anon.shop_cap' => $workers - 1])
        ->and(Hook::query()->where('anon_id', $device->anon_id)->count())->toBe(1)
        ->and(Hook::query()->where('shop_id', $shop->id)->where('status', HookStatus::Available->value)->count())->toBe($workers - 1)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->value('count'))->toBe(1);
});

it('holds the daily cap of 2 when one anon id reserves at 8 shops in parallel on its first call of the day', function (): void {
    $workers = 8;
    $device = HookWorld::anon();
    $this->anons[] = $device->anon_id;
    $token = HookWorld::anonToken($device);
    $jobs = [];

    for ($n = 0; $n < $workers; $n++) {
        [$shop, $item] = attack03Shop($this);
        $jobs[] = ['scenario' => 'http', 'args' => [
            'method' => 'POST',
            'uri' => '/api/v1/hooks/reserve',
            'token' => $token,
            'body' => json_encode(['shop_id' => $shop->id, 'item_id' => $item->id], JSON_THROW_ON_ERROR),
        ]];
    }

    expect(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->exists())->toBeFalse();

    $results = ConcurrencyHarness::run($jobs, $workers);

    expect(AttackKit::tally($results))->toBe(['201 ok' => 2, '409 anon.daily_cap' => $workers - 2])
        ->and(Hook::query()->where('anon_id', $device->anon_id)->where('status', HookStatus::Reserved->value)->count())->toBe(2)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->count())->toBe(1)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->value('count'))->toBe(2);
});

it('bounds a farm of anon ids behind one address with the per-address reserve limiter', function (): void {
    $limit = (int) config('askida.limits.hooks_reserve_per_hour_ip');
    expect($limit)->toBe(60);
    [$shop, $item] = attack03Shop($this);
    $farmIp = '198.51.100.77';
    $missing = (string) Str::uuid7();

    for ($i = 0; $i < $limit; $i++) {
        $device = HookWorld::anon();
        $this->anons[] = $device->anon_id;
        $response = AttackKit::json('POST', '/api/v1/hooks/reserve', HookWorld::anonToken($device), ['shop_id' => $missing, 'item_id' => $item->id], ip: $farmIp);
        AttackKit::assertProblem($response, 404, 'not_found');
    }

    $fresh = HookWorld::anon();
    $this->anons[] = $fresh->anon_id;
    AttackKit::assertProblem(attack03Reserve(HookWorld::anonToken($fresh), $shop, $item, $farmIp), 429, 'rate_limited');
    expect(Hook::query()->where('shop_id', $shop->id)->where('status', HookStatus::Available->value)->count())->toBe(1);

    // Negative control: the same fresh device from another address reserves.
    attack03Reserve(HookWorld::anonToken($fresh), $shop, $item, '198.51.100.78')->assertCreated();
});

it('refuses a banned anon id on reserve even with a token issued before the ban', function (): void {
    [$shop, $item] = attack03Shop($this);
    $device = HookWorld::anon();
    $this->anons[] = $device->anon_id;
    $token = HookWorld::anonToken($device);

    DB::table('anon_devices')->where('id', $device->id)->update(['banned_at' => CarbonImmutable::now()->format('Y-m-d H:i:s.uP')]);

    AttackKit::assertProblem(attack03Reserve($token, $shop, $item), 401, 'auth.unauthenticated');
    expect(Hook::query()->where('shop_id', $shop->id)->where('status', HookStatus::Available->value)->count())->toBe(1);
});
