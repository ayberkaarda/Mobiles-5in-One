<?php

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Jobs\TakeImpactSnapshot;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Impact\Services\ImpactSnapshotService;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    Cache::flush();
    Carbon::setTestNow('2026-10-04 15:00:00');
});

afterEach(fn () => Carbon::setTestNow());

function impactRow(string $il, string $ilce, string $day, int $donated, int $redeemed, int $shops): ImpactSnapshot
{
    $row = new ImpactSnapshot;
    $row->forceFill(compact('il', 'ilce', 'day', 'donated', 'redeemed', 'shops'))->save();

    return $row;
}

/**
 * @return array<string, array{donated: int, redeemed: int, shops: int}>
 */
function snapshotCells(string $day): array
{
    return ImpactSnapshot::query()->whereDate('day', $day)->orderBy('ilce')->get()
        ->mapWithKeys(fn (ImpactSnapshot $row): array => [$row->il.'/'.$row->ilce => ['donated' => $row->donated, 'redeemed' => $row->redeemed, 'shops' => $row->shops]])
        ->all();
}

it('counts paid units, redeemed units and verified shops per district for the day', function (): void {
    $owner = User::factory()->merchant()->create();
    $kadikoy = AccountsWorld::shop($owner);
    $kadikoySecond = AccountsWorld::shop($owner);
    $besiktas = AccountsWorld::shop($owner, ['ilce' => 'Beşiktaş']);
    AccountsWorld::shop($owner, ['ilce' => 'Beşiktaş', 'verification_state' => ShopVerificationState::Pending, 'verified_at' => null]);
    $sample = AccountsWorld::shop($owner, ['is_sample' => true]);

    $bread = AccountsWorld::item($kadikoy);
    $paid = AccountsWorld::donation(null, $bread, qty: 3);
    AccountsWorld::donation(null, AccountsWorld::item($kadikoySecond), qty: 2);
    AccountsWorld::donation(null, $bread, DonationStatus::Initiated, qty: 5);
    AccountsWorld::donation(null, $bread, DonationStatus::Failed, qty: 4);
    AccountsWorld::donation(null, $bread, qty: 7, paidAt: Carbon::parse('2026-10-03 23:30:00'));
    AccountsWorld::hook($paid, HookStatus::Redeemed);
    AccountsWorld::hook($paid, HookStatus::Redeemed, at: Carbon::parse('2026-10-03 22:00:00'));
    AccountsWorld::hook($paid, HookStatus::Available);
    AccountsWorld::hook($paid, HookStatus::Reserved);

    $besiktasPaid = AccountsWorld::donation(null, AccountsWorld::item($besiktas), qty: 1, paidAt: Carbon::parse('2026-10-04 00:10:00'));
    AccountsWorld::hook($besiktasPaid, HookStatus::Redeemed);

    // Sample rows never count.
    $samplePaid = AccountsWorld::donation(null, AccountsWorld::item($sample), qty: 9);
    AccountsWorld::hook($samplePaid, HookStatus::Redeemed);

    expect(app(ImpactSnapshotService::class)->snapshot())->toBe(2)
        ->and(snapshotCells('2026-10-04'))->toBe([
            'İstanbul/Beşiktaş' => ['donated' => 1, 'redeemed' => 1, 'shops' => 1],
            'İstanbul/Kadıköy' => ['donated' => 5, 'redeemed' => 1, 'shops' => 2],
        ]);

    app(ImpactSnapshotService::class)->snapshot(Carbon::parse('2026-10-03'));
    expect(snapshotCells('2026-10-03'))->toBe([
        'İstanbul/Beşiktaş' => ['donated' => 0, 'redeemed' => 0, 'shops' => 1],
        'İstanbul/Kadıköy' => ['donated' => 7, 'redeemed' => 1, 'shops' => 2],
    ]);
});

it('upserts the same rows on every run and zeroes districts that went quiet', function (): void {
    $owner = User::factory()->merchant()->create();
    $shop = AccountsWorld::shop($owner);
    AccountsWorld::donation(null, AccountsWorld::item($shop), qty: 2);

    app(ImpactSnapshotService::class)->snapshot();
    app(ImpactSnapshotService::class)->snapshot();
    expect(ImpactSnapshot::query()->count())->toBe(1)
        ->and(snapshotCells('2026-10-04'))->toBe(['İstanbul/Kadıköy' => ['donated' => 2, 'redeemed' => 0, 'shops' => 1]]);

    $shop->forceFill(['verification_state' => ShopVerificationState::Rejected])->save();
    $shop->donations()->update(['status' => 'refunded']);

    app(ImpactSnapshotService::class)->snapshot();
    expect(ImpactSnapshot::query()->count())->toBe(1)
        ->and(snapshotCells('2026-10-04'))->toBe(['İstanbul/Kadıköy' => ['donated' => 0, 'redeemed' => 0, 'shops' => 0]]);
});

it('runs the job for yesterday and today and schedules it hourly', function (): void {
    $owner = User::factory()->merchant()->create();
    AccountsWorld::shop($owner);

    (new TakeImpactSnapshot)->handle(app(ImpactSnapshotService::class));

    expect(ImpactSnapshot::query()->pluck('day')->map(fn ($day): string => $day->toDateString())->sort()->values()->all())
        ->toBe(['2026-10-03', '2026-10-04']);

    $events = collect(app(Schedule::class)->events())->filter(fn ($event): bool => $event->description === TakeImpactSnapshot::NAME);
    expect($events)->toHaveCount(1)->and($events->first()->expression)->toBe('0 * * * *');
});

it('serves the latest day of a district with the methodology key and nothing else', function (): void {
    impactRow('İstanbul', 'Kadıköy', '2026-10-03', 50, 40, 3);
    impactRow('İstanbul', 'Kadıköy', '2026-10-04', 12, 9, 3);
    impactRow('İstanbul', 'Beşiktaş', '2026-10-04', 4, 2, 1);

    $response = $this->getJson('/api/v1/impact?il='.rawurlencode('İstanbul').'&ilce='.rawurlencode('Kadıköy'));

    $response->assertOk()->assertExactJson(['data' => [
        'day' => '2026-10-04',
        'level' => 'ilce',
        'il' => 'İstanbul',
        'ilce' => 'Kadıköy',
        'donated' => 12,
        'redeemed' => 9,
        'shops' => 3,
        'methodology' => 'impact.v1.daily_units',
    ]]);
    expect($response->headers->get('Cache-Control'))->toContain('no-store');
});

it('rolls a district with too few shops up to the province, and the province up to the country', function (): void {
    impactRow('İstanbul', 'Kadıköy', '2026-10-04', 12, 9, 3);
    impactRow('İstanbul', 'Beşiktaş', '2026-10-04', 4, 2, 1);
    impactRow('Ankara', 'Çankaya', '2026-10-04', 3, 1, 2);

    $this->getJson('/api/v1/impact?il='.rawurlencode('İstanbul').'&ilce='.rawurlencode('Beşiktaş'))
        ->assertOk()
        ->assertJsonPath('data.level', 'il')
        ->assertJsonPath('data.ilce', null)
        ->assertJsonPath('data.donated', 16)
        ->assertJsonPath('data.shops', 4);

    $this->getJson('/api/v1/impact?il=Ankara')
        ->assertOk()
        ->assertJsonPath('data.level', 'tr')
        ->assertJsonPath('data.il', null)
        ->assertJsonPath('data.donated', 19)
        ->assertJsonPath('data.redeemed', 12)
        ->assertJsonPath('data.shops', 6);

    $this->getJson('/api/v1/impact')->assertOk()->assertJsonPath('data.level', 'tr')->assertJsonPath('data.donated', 19);
});

it('answers zeros before the first snapshot', function (): void {
    $this->getJson('/api/v1/impact')->assertOk()->assertExactJson(['data' => [
        'day' => null, 'level' => 'tr', 'il' => null, 'ilce' => null,
        'donated' => 0, 'redeemed' => 0, 'shops' => 0, 'methodology' => 'impact.v1.daily_units',
    ]]);
});

it('serves repeated reads from the cache for five minutes', function (): void {
    impactRow('İstanbul', 'Kadıköy', '2026-10-04', 12, 9, 3);
    $url = '/api/v1/impact?il='.rawurlencode('İstanbul').'&ilce='.rawurlencode('Kadıköy');

    $this->getJson($url)->assertJsonPath('data.donated', 12);

    ImpactSnapshot::query()->update(['donated' => 99]);

    $this->getJson($url)->assertJsonPath('data.donated', 12);

    Carbon::setTestNow(Carbon::now()->addMinutes(5)->addSecond());
    $this->getJson($url)->assertJsonPath('data.donated', 99);
});

it('is public and validates the place names', function (string $query, string $field, string $code): void {
    AuthTestKit::assertProblem($this->getJson('/api/v1/impact?'.$query), 422, 'validation.failed', [['field' => $field, 'code' => $code]]);
})->with([
    'district without province' => ['ilce=Kad%C4%B1k%C3%B6y', 'il', 'required_with'],
    'markup' => ['il=%3Cscript%3E', 'il', 'regex'],
    'too long' => ['il='.str_repeat('a', 65), 'il', 'max'],
    'array' => ['il[]=a', 'il', 'string'],
]);
