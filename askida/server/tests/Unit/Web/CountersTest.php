<?php

use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Impact\DbCountersReader;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Cache::flush();
    config(['askida.allow_sample_shops' => false]);
    Carbon::setTestNow('2026-10-04 15:00:00');
});

afterEach(fn () => Carbon::setTestNow());

function countersSnapshot(string $il, string $ilce, string $day, int $donated, int $redeemed, int $shops): void
{
    $row = new ImpactSnapshot;
    $row->forceFill(compact('il', 'ilce', 'day', 'donated', 'redeemed', 'shops'))->save();
}

function countersHooks(Shop $shop, int $available): void
{
    $donation = AccountsWorld::donation(null, AccountsWorld::item($shop), qty: $available);

    foreach (range(1, $available) as $unused) {
        AccountsWorld::hook($donation, HookStatus::Available);
    }
}

it('is the bound reader of the public web', function (): void {
    expect(app(CountersReader::class))->toBeInstanceOf(DbCountersReader::class);
});

it('counts available units of verified non-sample shops and reads the latest snapshot day', function (): void {
    $shop = AccountsWorld::shop(null);
    countersHooks($shop, 4);
    countersHooks(AccountsWorld::shop(null, ['is_sample' => true]), 5);
    countersHooks(AccountsWorld::shop(null, ['verification_state' => ShopVerificationState::Pending, 'verified_at' => null]), 6);
    countersSnapshot('İstanbul', 'Kadıköy', '2026-10-03', 99, 99, 3);
    countersSnapshot('İstanbul', 'Kadıköy', '2026-10-04', 12, 7, 3);

    $home = app(CountersReader::class)->home();

    expect($home->availableNow)->toBe(4)
        ->and($home->donatedToday)->toBe(12)
        ->and($home->redeemedToday)->toBe(7)
        ->and($home->shops)->toBe(3)
        ->and($home->isSample)->toBeFalse()
        ->and($home->methodology)->toBe('impact.v1.daily_units')
        ->and($home->asOf->toDateString())->toBe('2026-10-04');
});

it('is all zero and not a sample when nothing exists and samples are off', function (): void {
    countersHooks(AccountsWorld::shop(null, ['is_sample' => true]), 2);

    $home = app(CountersReader::class)->home();

    expect([$home->availableNow, $home->donatedToday, $home->redeemedToday, $home->shops, $home->isSample])->toBe([0, 0, 0, 0, false]);
});

it('reads the sample shops and says so when samples are allowed and nothing real exists', function (): void {
    config(['askida.allow_sample_shops' => true]);
    countersHooks(AccountsWorld::shop(null, ['is_sample' => true]), 3);
    AccountsWorld::shop(null, ['is_sample' => true]);

    $home = app(CountersReader::class)->home();

    expect($home->isSample)->toBeTrue()->and($home->availableNow)->toBe(3)->and($home->shops)->toBe(2);

    // Real figures win as soon as they exist.
    Cache::flush();
    countersHooks(AccountsWorld::shop(null), 1);

    $real = app(CountersReader::class)->home();

    expect($real->isSample)->toBeFalse()->and($real->availableNow)->toBe(1);
});

it('answers a district by slug and rolls a small district up like the impact API', function (): void {
    countersHooks(AccountsWorld::shop(null, ['ilce' => 'Kadıköy']), 2);
    countersHooks(AccountsWorld::shop(null, ['ilce' => 'Beşiktaş']), 1);
    countersSnapshot('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 1);
    countersSnapshot('İstanbul', 'Beşiktaş', '2026-10-04', 4, 3, 1);
    countersSnapshot('İstanbul', 'Fatih', '2026-10-04', 1, 1, 2);

    $reader = app(CountersReader::class);
    $kadikoy = $reader->district('istanbul', 'kadikoy');
    $istanbul = $reader->district('istanbul', null);

    // One shop in the district: the figures roll up to the province (4 shops), the available
    // count stays the asked district's.
    expect($kadikoy->level)->toBe('il')
        ->and($kadikoy->availableNow)->toBe(2)
        ->and($kadikoy->donated)->toBe(10)
        ->and($kadikoy->shops)->toBe(4)
        ->and($kadikoy->day)->toBe('2026-10-04')
        ->and($istanbul->level)->toBe('il')
        ->and($istanbul->availableNow)->toBe(3)
        ->and($istanbul->ilce)->toBeNull();
});

it('answers an unknown district from the country level with zero available', function (): void {
    countersSnapshot('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 3);

    $unknown = app(CountersReader::class)->district('yok', 'yok');

    expect($unknown->level)->toBe('tr')->and($unknown->availableNow)->toBe(0)->and($unknown->donated)->toBe(5);
});

it('caches the answer for five minutes', function (): void {
    countersSnapshot('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 3);

    expect(app(CountersReader::class)->home()->donatedToday)->toBe(5);

    ImpactSnapshot::query()->update(['donated' => 50]);
    Cache::forget('impact:v1:'.hash('sha256', "\n"));

    expect(app(CountersReader::class)->home()->donatedToday)->toBe(5);

    Carbon::setTestNow('2026-10-04 15:06:00');
    Cache::forget('impact:v1:'.hash('sha256', "\n"));

    expect(app(CountersReader::class)->home()->donatedToday)->toBe(50);
});
