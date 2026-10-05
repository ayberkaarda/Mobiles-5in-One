<?php

use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;
use Tests\Security\Concurrency\ConcurrencyHarness;

/*
| Threat 4.2, redemption race and double-spend, through the whole HTTP stack: N separate
| OS processes (ConcurrencyHarness, `http` scenario) send POST shops/{shop}/redeem with
| the same code at the same instant. Exactly one gets 200; every other one gets the
| opaque 422 `hook.code_invalid`; the unit is REDEEMED once, by one of the callers.
| (No RefreshDatabase: the worker processes must see committed fixtures; afterEach
| removes them by id.)
*/

beforeEach(function (): void {
    ConcurrencyHarness::ensureSchema();
    HookWorld::pepper();
    $this->shops = [];
    $this->anons = [];
});

afterEach(function (): void {
    ConcurrencyHarness::cleanup($this->shops, $this->anons);
});

afterAll(function (): void {
    ConcurrencyHarness::shutdown();
});

it('lets exactly one of 8 parallel redeem requests for one code succeed', function (): void {
    $workers = 8;
    $shop = HookWorld::shop();
    $this->shops[] = $shop->id;
    [$hook] = HookWorld::availableHooks(HookWorld::item($shop), 1);
    $device = HookWorld::anon();
    $this->anons[] = $device->anon_id;
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, $device, $code);

    $owner = HookWorld::owner($shop);
    $staff = HookWorld::staff($shop);
    $jobs = [];
    $callers = [];

    for ($n = 0; $n < $workers; $n++) {
        $user = $n % 2 === 0 ? $owner : $staff;
        $callers[] = $user->id;
        $jobs[] = ['scenario' => 'http', 'args' => [
            'method' => 'POST',
            'uri' => "/api/v1/shops/{$shop->id}/redeem",
            'token' => HookWorld::userToken($user, 'race-device-'.$n),
            'body' => json_encode(['code' => $code], JSON_THROW_ON_ERROR),
        ]];
    }

    $results = ConcurrencyHarness::run($jobs, $workers);

    expect(AttackKit::tally($results))->toBe(['200 ok' => 1, '422 hook.code_invalid' => $workers - 1]);

    $row = DB::table('hooks')->where('id', $hook->id)->first();
    expect($row->status)->toBe(HookStatus::Redeemed->value)
        ->and($row->redeemed_by_user_id)->toBeIn(array_unique($callers))
        ->and($row->redeemed_at)->not->toBeNull()
        ->and(Hook::query()->where('shop_id', $shop->id)->where('status', HookStatus::Redeemed->value)->count())->toBe(1);
});

it('redeems each of two live codes exactly once when 8 parallel requests split between them', function (): void {
    $workers = 8;
    $shop = HookWorld::shop();
    $this->shops[] = $shop->id;
    $hooks = HookWorld::availableHooks(HookWorld::item($shop), 2);
    $codes = [];

    foreach ($hooks as $hook) {
        $device = HookWorld::anon();
        $this->anons[] = $device->anon_id;
        $code = HookWorld::newCode();
        HookWorld::reserve($hook, $device, $code);
        $codes[] = $code;
    }

    $owner = HookWorld::owner($shop);
    $jobs = [];

    for ($n = 0; $n < $workers; $n++) {
        $jobs[] = ['scenario' => 'http', 'args' => [
            'method' => 'POST',
            'uri' => "/api/v1/shops/{$shop->id}/redeem",
            'token' => HookWorld::userToken($owner, 'pool-device-'.$n),
            'body' => json_encode(['code' => $codes[$n % 2]], JSON_THROW_ON_ERROR),
        ]];
    }

    $results = ConcurrencyHarness::run($jobs, $workers);

    expect(AttackKit::tally($results))->toBe(['200 ok' => 2, '422 hook.code_invalid' => $workers - 2])
        ->and(Hook::query()->where('shop_id', $shop->id)->where('status', HookStatus::Redeemed->value)->count())->toBe(2);
});

it('negative control: a single redeem request of a live code succeeds through the same worker path', function (): void {
    $shop = HookWorld::shop();
    $this->shops[] = $shop->id;
    [$hook] = HookWorld::availableHooks(HookWorld::item($shop), 1);
    $device = HookWorld::anon();
    $this->anons[] = $device->anon_id;
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, $device, $code);

    $results = ConcurrencyHarness::run([['scenario' => 'http', 'args' => [
        'method' => 'POST',
        'uri' => "/api/v1/shops/{$shop->id}/redeem",
        'token' => HookWorld::userToken(HookWorld::owner($shop), 'single-device'),
        'body' => json_encode(['code' => $code], JSON_THROW_ON_ERROR),
    ]]], 1);

    expect(AttackKit::tally($results))->toBe(['200 ok' => 1])
        ->and($hook->fresh()?->status)->toBe(HookStatus::Redeemed);
});
