<?php

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Hooks\Codes\HookCode;
use App\Domain\Hooks\Codes\HookCodeGenerator;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| POST /api/v1/hooks/reserve (story 5): one unit per call, caps per device and item,
| lazy expiry, code storage as a keyed hash only.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
});

function reserveCall(?string $token, array $body): TestResponse
{
    app('auth')->forgetGuards();

    return test()->postJson('/api/v1/hooks/reserve', $body, $token === null ? [] : ['Authorization' => 'Bearer '.$token]);
}

it('reserves the oldest available unit and returns the code once', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$oldest, $newer] = HookWorld::availableHooks($item, 2);
    $device = HookWorld::anon();

    $response = reserveCall(HookWorld::anonToken($device), ['shop_id' => $shop->id, 'item_id' => $item->id]);

    $response->assertCreated();
    expect(array_keys($response->json()))->toBe(['code', 'expires_at', 'shop', 'item'])
        ->and(array_keys($response->json('shop')))->toBe(['id', 'name'])
        ->and(array_keys($response->json('item')))->toBe(['name', 'category'])
        ->and($response->json('shop.id'))->toBe($shop->id)
        ->and($response->json('item.name'))->toBe('Ekmek')
        ->and($response->json('item.category'))->toBe('ekmek')
        ->and(CarbonImmutable::parse($response->json('expires_at'))->equalTo(CarbonImmutable::now()->addMinutes(10)))->toBeTrue();

    $code = (string) $response->json('code');
    expect(HookCode::isValid($code))->toBeTrue();

    $reserved = $oldest->fresh();
    expect($reserved?->status)->toBe(HookStatus::Reserved)
        ->and($reserved?->anon_id)->toBe($device->anon_id)
        ->and($reserved?->code_hash)->toBe(hash_hmac('sha256', $code, HookWorld::pepper()))
        ->and($newer->fresh()?->status)->toBe(HookStatus::Available);

    // The plaintext code is stored nowhere in the hook row.
    $raw = (array) DB::table('hooks')->where('id', $oldest->id)->first();
    expect(implode('|', array_map(strval(...), array_filter($raw, is_scalar(...)))))->not->toContain($code);

    $counter = AnonDailyCounter::query()->where('anon_id', $device->anon_id)->firstOrFail();
    expect($counter->count)->toBe(1)
        ->and($counter->per_shop)->toBe([$shop->id => 1])
        ->and($counter->day->toDateString())->toBe('2026-10-04');
});

it('enforces 1 unit per shop and 2 units per Istanbul day for a device', function (): void {
    $device = HookWorld::anon();
    $token = HookWorld::anonToken($device);
    $shops = [];

    foreach (range(1, 3) as $n) {
        $shop = HookWorld::shop();
        $item = HookWorld::item($shop);
        HookWorld::availableHooks($item, 2);
        $shops[] = [$shop, $item];
    }

    reserveCall($token, ['shop_id' => $shops[0][0]->id, 'item_id' => $shops[0][1]->id])->assertCreated();

    $sameShop = reserveCall($token, ['shop_id' => $shops[0][0]->id, 'item_id' => $shops[0][1]->id]);
    $sameShop->assertStatus(409);
    expect($sameShop->json('code'))->toBe('anon.shop_cap');

    reserveCall($token, ['shop_id' => $shops[1][0]->id, 'item_id' => $shops[1][1]->id])->assertCreated();

    $third = reserveCall($token, ['shop_id' => $shops[2][0]->id, 'item_id' => $shops[2][1]->id]);
    $third->assertStatus(409);
    expect($third->json('code'))->toBe('anon.daily_cap')
        ->and(Hook::query()->where('anon_id', $device->anon_id)->count())->toBe(2);

    // A new Istanbul calendar day starts at local midnight.
    $this->travelTo(CarbonImmutable::parse('2026-10-05 00:01:00', 'Europe/Istanbul'));
    reserveCall($token, ['shop_id' => $shops[2][0]->id, 'item_id' => $shops[2][1]->id])->assertCreated();
});

it('keeps counting a reservation that expired unredeemed against the device caps', function (): void {
    $device = HookWorld::anon();
    $token = HookWorld::anonToken($device);
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    HookWorld::availableHooks($item, 2);

    reserveCall($token, ['shop_id' => $shop->id, 'item_id' => $item->id])->assertCreated();
    $this->travel(11)->minutes();

    expect(reserveCall($token, ['shop_id' => $shop->id, 'item_id' => $item->id])->json('code'))->toBe('anon.shop_cap');
});

it('enforces the item daily cap over reserved and redeemed units of the day', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop, dailyCap: 2);
    [$first, $second] = HookWorld::availableHooks($item, 4);
    $merchant = HookWorld::owner($shop);

    HookWorld::reserve($first, HookWorld::anon(), HookWorld::newCode());
    $second = HookWorld::reserve($second, HookWorld::anon(), HookWorld::newCode());
    DB::table('hooks')->where('id', $second->id)->update([
        'status' => 'REDEEMED',
        'redeemed_at' => CarbonImmutable::now()->format('Y-m-d H:i:s.uP'),
        'redeemed_by_user_id' => $merchant->id,
    ]);

    $response = reserveCall(HookWorld::anonToken(HookWorld::anon()), ['shop_id' => $shop->id, 'item_id' => $item->id]);

    $response->assertStatus(409);
    expect($response->json('code'))->toBe('hook.none_available')
        ->and(Hook::query()->where('item_id', $item->id)->where('status', 'AVAILABLE')->count())->toBe(2);
});

it('answers hook.none_available when no unit is left', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);

    $response = reserveCall(HookWorld::anonToken(HookWorld::anon()), ['shop_id' => $shop->id, 'item_id' => $item->id]);

    $response->assertStatus(409);
    expect($response->json('code'))->toBe('hook.none_available')
        ->and(AnonDailyCounter::query()->count())->toBe(0);
});

it('releases an expired reservation lazily, without the release job', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$only] = HookWorld::availableHooks($item, 1);
    HookWorld::reserve($only, HookWorld::anon(), HookWorld::newCode(), CarbonImmutable::now()->subMinutes(15));

    $device = HookWorld::anon();
    reserveCall(HookWorld::anonToken($device), ['shop_id' => $shop->id, 'item_id' => $item->id])->assertCreated();

    expect($only->fresh()?->anon_id)->toBe($device->anon_id)
        ->and($only->fresh()?->status)->toBe(HookStatus::Reserved);
});

it('hides unverified shops, inactive items and items of other shops as not found', function (): void {
    $token = HookWorld::anonToken(HookWorld::anon());

    $pending = HookWorld::shop(verified: false);
    $pendingItem = HookWorld::item($pending);
    HookWorld::availableHooks($pendingItem, 1);

    $shop = HookWorld::shop();
    $inactive = HookWorld::item($shop, active: false);
    HookWorld::availableHooks($inactive, 1);

    $other = HookWorld::shop();
    $foreignItem = HookWorld::item($other);
    HookWorld::availableHooks($foreignItem, 1);

    foreach ([
        ['shop_id' => $pending->id, 'item_id' => $pendingItem->id],
        ['shop_id' => $shop->id, 'item_id' => $inactive->id],
        ['shop_id' => $shop->id, 'item_id' => $foreignItem->id],
        ['shop_id' => (string) Str::uuid7(), 'item_id' => (string) Str::uuid7()],
    ] as $body) {
        $response = reserveCall($token, $body);
        $response->assertNotFound();
        expect($response->json('code'))->toBe('not_found');
    }

    expect(Hook::query()->where('status', 'RESERVED')->count())->toBe(0);
});

it('validates the body and never takes an anon id from it', function (array $body, string $field, string $rule): void {
    $response = reserveCall(HookWorld::anonToken(HookWorld::anon()), $body);

    $response->assertStatus(422);
    expect($response->json('code'))->toBe('validation.failed')
        ->and($response->json('errors'))->toContain(['field' => $field, 'code' => $rule]);
})->with([
    'missing shop' => [['item_id' => '0192f0c4-0000-7000-8000-000000000001'], 'shop_id', 'required'],
    'shop not a uuid' => [['shop_id' => 'shop-1', 'item_id' => '0192f0c4-0000-7000-8000-000000000001'], 'shop_id', 'uuid'],
    'anon id in body' => [['shop_id' => '0192f0c4-0000-7000-8000-000000000001', 'item_id' => '0192f0c4-0000-7000-8000-000000000002', 'anon_id' => 'someone-else'], 'anon_id', 'prohibited'],
]);

it('accepts anon tokens only and refuses banned devices', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    HookWorld::availableHooks($item, 1);
    $body = ['shop_id' => $shop->id, 'item_id' => $item->id];

    expect(reserveCall(null, $body)->status())->toBe(401)
        ->and(reserveCall(HookWorld::userToken(HookWorld::donor()), $body)->json('code'))->toBe('forbidden')
        ->and(reserveCall(HookWorld::userToken(HookWorld::merchant()), $body)->status())->toBe(403);

    $banned = HookWorld::anon();
    $token = HookWorld::anonToken($banned);
    $banned->forceFill(['banned_at' => now()])->save();

    expect(reserveCall($token, $body)->json('code'))->toBe('auth.unauthenticated')
        ->and(Hook::query()->where('status', 'RESERVED')->count())->toBe(0);
});

it('retries a code that collides with a live code of the same shop', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$taken, $free] = HookWorld::availableHooks($item, 2);
    $live = HookWorld::newCode();
    HookWorld::reserve($taken, HookWorld::anon(), $live);
    $fresh = HookWorld::newCode();

    app()->instance(HookCodeGenerator::class, new class([$live, $live, $fresh]) extends HookCodeGenerator
    {
        /** @param list<string> $codes */
        public function __construct(private array $codes) {}

        public function generate(): string
        {
            return array_shift($this->codes) ?? throw new LogicException('No scripted code left.');
        }
    });

    $response = reserveCall(HookWorld::anonToken(HookWorld::anon()), ['shop_id' => $shop->id, 'item_id' => $item->id]);

    $response->assertCreated();
    expect($response->json('code'))->toBe($fresh)
        ->and($free->fresh()?->code_hash)->toBe(HookWorld::hash($fresh));
});

it('gives up after five colliding codes and leaves nothing half done', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$taken, $free] = HookWorld::availableHooks($item, 2);
    $live = HookWorld::newCode();
    HookWorld::reserve($taken, HookWorld::anon(), $live);

    app()->instance(HookCodeGenerator::class, new class($live) extends HookCodeGenerator
    {
        public int $calls = 0;

        public function __construct(private readonly string $code) {}

        public function generate(): string
        {
            $this->calls++;

            return $this->code;
        }
    });

    $device = HookWorld::anon();
    $response = reserveCall(HookWorld::anonToken($device), ['shop_id' => $shop->id, 'item_id' => $item->id]);

    $response->assertStatus(503);
    expect($response->json('code'))->toBe('service_unavailable')
        ->and(app(HookCodeGenerator::class)->calls)->toBe(5)
        ->and($free->fresh()?->status)->toBe(HookStatus::Available)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->exists())->toBeFalse();
});

it('limits reserve calls to 5 an hour per device', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    $token = HookWorld::anonToken(HookWorld::anon());
    $body = ['shop_id' => $shop->id, 'item_id' => $item->id];

    foreach (range(1, 5) as $n) {
        reserveCall($token, $body)->assertStatus(409);
    }

    $limited = reserveCall($token, $body);
    $limited->assertStatus(429);
    expect($limited->json('code'))->toBe('rate_limited')
        ->and($limited->headers->get('Retry-After'))->not->toBeNull();

    // Another device keeps its own budget.
    reserveCall(HookWorld::anonToken(HookWorld::anon()), $body)->assertStatus(409);
});

it('limits reserve calls per client IP across devices', function (): void {
    config(['askida.limits.hooks_reserve_per_hour_ip' => 2]);
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    $body = ['shop_id' => $shop->id, 'item_id' => $item->id];

    reserveCall(HookWorld::anonToken(HookWorld::anon()), $body)->assertStatus(409);
    reserveCall(HookWorld::anonToken(HookWorld::anon()), $body)->assertStatus(409);

    $limited = reserveCall(HookWorld::anonToken(HookWorld::anon()), $body);
    $limited->assertStatus(429);
    expect($limited->json('code'))->toBe('rate_limited');
});
