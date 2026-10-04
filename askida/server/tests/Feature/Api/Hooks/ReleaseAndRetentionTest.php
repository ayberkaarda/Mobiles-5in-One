<?php

use App\Domain\Anon\Jobs\PurgeOldAnonData;
use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Services\AnonRetentionService;
use App\Domain\Hooks\Jobs\ReleaseExpiredHooks;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Hooks\Services\HookReleaseService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| Job hooks.release-expired (every minute) and job anon.purge-old (daily, rule AN-6).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
});

it('releases expired reservations only and clears every reservation column', function (): void {
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$expired, $live, $redeemed, $available] = HookWorld::availableHooks($item, 4);
    HookWorld::reserve($expired, HookWorld::anon(), HookWorld::newCode(), CarbonImmutable::now()->subMinutes(12));
    HookWorld::reserve($live, HookWorld::anon(), HookWorld::newCode(), CarbonImmutable::now()->subMinutes(3));
    HookWorld::reserve($redeemed, HookWorld::anon(), HookWorld::newCode(), CarbonImmutable::now()->subMinutes(30));
    DB::table('hooks')->where('id', $redeemed->id)->update(['status' => 'REDEEMED', 'redeemed_at' => now()->subMinutes(25)]);

    (new ReleaseExpiredHooks)->handle(app(HookReleaseService::class));

    $fresh = $expired->fresh();
    expect($fresh?->status)->toBe(HookStatus::Available)
        ->and([$fresh?->anon_id, $fresh?->code_hash, $fresh?->reserved_at, $fresh?->expires_at])->toBe([null, null, null, null])
        ->and($live->fresh()?->status)->toBe(HookStatus::Reserved)
        ->and($redeemed->fresh()?->status)->toBe(HookStatus::Redeemed)
        ->and($available->fresh()?->status)->toBe(HookStatus::Available)
        ->and(app(HookReleaseService::class)->releaseExpired())->toBe(0);
});

it('releases in batches until nothing expired is left', function (): void {
    config(['askida.hooks.release_batch_size' => 2]);
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);

    foreach (HookWorld::availableHooks($item, 5) as $hook) {
        HookWorld::reserve($hook, HookWorld::anon(), HookWorld::newCode(), CarbonImmutable::now()->subMinutes(20));
    }

    expect(app(HookReleaseService::class)->releaseExpired())->toBe(5)
        ->and(DB::table('hooks')->where('status', 'RESERVED')->count())->toBe(0);
});

it('schedules the release job every minute and the purge job daily', function (): void {
    $events = collect(app(Schedule::class)->events())->keyBy(fn ($event): string => (string) $event->description);

    expect($events->keys()->all())->toContain('hooks.release-expired', 'anon.purge-old')
        ->and($events['hooks.release-expired']->expression)->toBe('* * * * *')
        ->and($events['anon.purge-old']->expression)->toBe('15 3 * * *')
        ->and($events['anon.purge-old']->timezone)->toBe('Europe/Istanbul');
});

it('purges counters and device links older than 30 days', function (): void {
    $device = HookWorld::anon();
    $old = (new AnonDailyCounter)->forceFill(['anon_id' => $device->anon_id, 'day' => '2026-09-03', 'count' => 1, 'per_shop' => []]);
    $old->save();
    $kept = (new AnonDailyCounter)->forceFill(['anon_id' => $device->anon_id, 'day' => '2026-09-04', 'count' => 1, 'per_shop' => []]);
    $kept->save();

    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$oldRedeemed, $recentRedeemed, $live] = HookWorld::availableHooks($item, 3);
    foreach ([[$oldRedeemed, '2026-09-03 18:00:00'], [$recentRedeemed, '2026-09-20 18:00:00']] as [$hook, $at]) {
        $time = CarbonImmutable::parse($at, 'Europe/Istanbul');
        HookWorld::reserve($hook, $device, HookWorld::newCode(), $time->subMinutes(5));
        DB::table('hooks')->where('id', $hook->id)->update(['status' => 'REDEEMED', 'redeemed_at' => $time->format('Y-m-d H:i:s.uP')]);
    }
    HookWorld::reserve($live, $device, HookWorld::newCode());

    (new PurgeOldAnonData)->handle(app(AnonRetentionService::class));

    expect(AnonDailyCounter::query()->pluck('id')->all())->toBe([$kept->id])
        ->and($oldRedeemed->fresh()?->anon_id)->toBeNull()
        ->and($oldRedeemed->fresh()?->status)->toBe(HookStatus::Redeemed)
        ->and($recentRedeemed->fresh()?->anon_id)->toBe($device->anon_id)
        ->and($live->fresh()?->anon_id)->toBe($device->anon_id);
});
