<?php

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Services\HookReservationService;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Concurrency\ConcurrencyHarness;

/*
| Security items 4 and 23: races between separate OS processes on the real database.
| Outcomes may differ from run to run; the invariants asserted here may not.
| (No RefreshDatabase: the workers must see committed fixtures; afterEach removes them.)
*/

const RACE_WORKERS = 8;

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

/**
 * @return array{0: Shop, 1: Item}
 */
function raceShop(object $test, int $units, int $dailyCap = 100): array
{
    $shop = HookWorld::shop();
    $test->shops[] = $shop->id;
    $item = HookWorld::item($shop, $dailyCap);
    HookWorld::availableHooks($item, $units);

    return [$shop, $item];
}

function raceAnon(object $test): AnonDevice
{
    $device = HookWorld::anon();
    $test->anons[] = $device->anon_id;

    return $device;
}

/**
 * @param  list<array<string, mixed>>  $results
 * @return array<string, int>
 */
function outcomes(array $results): array
{
    $counts = [];

    foreach ($results as $result) {
        $key = ($result['ok'] ?? false) ? 'ok' : (string) ($result['code'] ?? 'unknown');
        $counts[$key] = ($counts[$key] ?? 0) + 1;
    }

    ksort($counts);

    return $counts;
}

it('lets one device reserve once at a shop however many parallel calls it makes', function (): void {
    [$shop, $item] = raceShop($this, RACE_WORKERS);
    $device = raceAnon($this);

    $results = ConcurrencyHarness::run(array_fill(0, RACE_WORKERS, [
        'scenario' => 'reserve',
        'args' => ['anon_id' => $device->anon_id, 'shop_id' => $shop->id, 'item_id' => $item->id],
    ]), RACE_WORKERS);

    expect(outcomes($results))->toBe(['anon.shop_cap' => RACE_WORKERS - 1, 'ok' => 1])
        ->and(Hook::query()->where('anon_id', $device->anon_id)->where('status', 'RESERVED')->count())->toBe(1)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->value('count'))->toBe(1);
});

it('keeps the daily cap of a device that already reserved today under parallel calls', function (): void {
    [$firstShop, $firstItem] = raceShop($this, 1);
    [$shop, $item] = raceShop($this, RACE_WORKERS);
    $device = raceAnon($this);
    // The earlier reservation of the day leaves the counter row in place (count 1), so
    // the parallel calls below meet on its row lock, not on the first insert of the day.
    app(HookReservationService::class)->reserve($device, $firstShop->id, $firstItem->id);

    $results = ConcurrencyHarness::run(array_fill(0, RACE_WORKERS, [
        'scenario' => 'reserve',
        'args' => ['anon_id' => $device->anon_id, 'shop_id' => $shop->id, 'item_id' => $item->id],
    ]), RACE_WORKERS);

    expect(outcomes($results))->toBe(['anon.daily_cap' => RACE_WORKERS - 1, 'ok' => 1])
        ->and(Hook::query()->where('anon_id', $device->anon_id)->where('status', 'RESERVED')->count())->toBe(2)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->value('count'))->toBe(2);
});

it('hands out K units to exactly K of N parallel devices, never one unit twice', function (): void {
    $units = 3;
    [$shop, $item] = raceShop($this, $units);
    $jobs = [];

    foreach (range(1, RACE_WORKERS) as $n) {
        $jobs[] = ['scenario' => 'reserve', 'args' => ['anon_id' => raceAnon($this)->anon_id, 'shop_id' => $shop->id, 'item_id' => $item->id]];
    }

    $results = ConcurrencyHarness::run($jobs, RACE_WORKERS);
    $won = array_column(array_filter($results, fn (array $r): bool => $r['ok']), 'hook_id');

    expect(outcomes($results))->toBe(['hook.none_available' => RACE_WORKERS - $units, 'ok' => $units])
        ->and(array_unique($won))->toHaveCount($units)
        ->and(Hook::query()->where('shop_id', $shop->id)->where('status', 'RESERVED')->distinct()->count('anon_id'))->toBe($units)
        ->and(Hook::query()->where('shop_id', $shop->id)->where('status', 'AVAILABLE')->count())->toBe(0);
});

it('holds the item daily cap under parallel reserves of different devices', function (): void {
    [$shop, $item] = raceShop($this, RACE_WORKERS, dailyCap: 2);
    $jobs = [];

    foreach (range(1, RACE_WORKERS) as $n) {
        $jobs[] = ['scenario' => 'reserve', 'args' => ['anon_id' => raceAnon($this)->anon_id, 'shop_id' => $shop->id, 'item_id' => $item->id]];
    }

    expect(outcomes(ConcurrencyHarness::run($jobs, RACE_WORKERS)))->toBe(['hook.none_available' => RACE_WORKERS - 2, 'ok' => 2])
        ->and(Hook::query()->where('item_id', $item->id)->where('status', 'RESERVED')->count())->toBe(2);
});

it('redeems a code exactly once under parallel redeems', function (): void {
    [$shop, $item] = raceShop($this, 1);
    $hook = Hook::query()->where('shop_id', $shop->id)->sole();
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, raceAnon($this), $code);
    $owner = HookWorld::owner($shop);
    $staff = HookWorld::staff($shop);
    $jobs = [];

    foreach (range(1, RACE_WORKERS) as $n) {
        $jobs[] = ['scenario' => 'redeem', 'args' => ['shop_id' => $shop->id, 'user_id' => ($n % 2 === 0 ? $owner : $staff)->id, 'code' => $code]];
    }

    $results = ConcurrencyHarness::run($jobs, RACE_WORKERS);

    expect(outcomes($results))->toBe(['hook.code_invalid' => RACE_WORKERS - 1, 'ok' => 1])
        ->and(Hook::query()->where('shop_id', $shop->id)->where('status', 'REDEEMED')->count())->toBe(1)
        ->and(DB::table('hooks')->where('id', $hook->id)->value('redeemed_by_user_id'))->toBeIn([$owner->id, $staff->id]);
});

it('never loses a redemption to the release job nor releases a unit twice', function (): void {
    $units = 6;
    [$shop, $item] = raceShop($this, $units);
    $reservedAt = CarbonImmutable::now()->subMinutes(30);
    $codes = [];

    foreach (Hook::query()->where('shop_id', $shop->id)->get() as $hook) {
        $code = HookWorld::newCode();
        HookWorld::reserve($hook, raceAnon($this), $code, $reservedAt);
        $codes[$hook->id] = $code;
    }

    $owner = HookWorld::owner($shop);
    // Redeemers act 5 minutes into the reservation, the release job 20 minutes in:
    // each side legitimately believes it may move the unit.
    $jobs = [];
    foreach ($codes as $code) {
        $jobs[] = ['scenario' => 'redeem', 'now' => $reservedAt->addMinutes(5)->toIso8601String(), 'args' => ['shop_id' => $shop->id, 'user_id' => $owner->id, 'code' => $code]];
    }
    $jobs[] = ['scenario' => 'release', 'now' => $reservedAt->addMinutes(20)->toIso8601String()];
    $jobs[] = ['scenario' => 'release', 'now' => $reservedAt->addMinutes(20)->toIso8601String()];

    $results = ConcurrencyHarness::run($jobs, RACE_WORKERS);
    $redeems = array_slice($results, 0, $units);
    $released = array_sum(array_column(array_slice($results, $units), 'released'));
    $redeemed = count(array_filter($redeems, fn (array $r): bool => $r['ok']));

    $statuses = Hook::query()->where('shop_id', $shop->id)->pluck('status')->map(fn ($s) => $s->value)->countBy()->all();

    expect($redeemed + $released)->toBe($units)
        ->and($statuses['REDEEMED'] ?? 0)->toBe($redeemed)
        ->and($statuses['AVAILABLE'] ?? 0)->toBe($released)
        ->and($statuses)->not->toHaveKey('RESERVED');

    // Per unit: the redeemer either won (REDEEMED) or found its code already released.
    $i = 0;
    foreach (array_keys($codes) as $hookId) {
        $result = $redeems[$i++];
        $status = Hook::query()->findOrFail($hookId)->status->value;

        expect($result['ok'] ? [true, $status] : [$result['code'], $status])
            ->toBe($result['ok'] ? [true, 'REDEEMED'] : ['hook.code_invalid', 'AVAILABLE']);
    }
});

it('issues the units of a donation once under parallel calls', function (): void {
    $shop = HookWorld::shop();
    $this->shops[] = $shop->id;
    $donation = HookWorld::donation(HookWorld::item($shop), qty: 5);

    $results = ConcurrencyHarness::run(array_fill(0, 6, ['scenario' => 'issue', 'args' => ['donation_id' => $donation->id]]), RACE_WORKERS);

    expect(array_sum(array_column($results, 'created')))->toBe(5)
        ->and(outcomes($results))->toBe(['ok' => 6])
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(5);
});
