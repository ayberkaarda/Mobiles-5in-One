<?php

use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payouts\Exceptions\PayoutNotHeld;
use App\Domain\Payouts\Services\PayoutHoldService;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Support\Payouts\PayoutWorld;

/*
| PayoutHoldService: hold(Shop, reason) for pending payouts, release(Payout, finance,
| reason) with the manage-payouts gate and an activity log entry.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->seed(RolesSeeder::class);
});

function adminUser(string $role): User
{
    $user = User::factory()->create();
    $user->assignRole($role);

    return $user;
}

it('holds only pending payouts and is idempotent', function (): void {
    $shop = HookWorld::shop();
    $pending = PayoutWorld::payout($shop, PayoutStatus::Pending, '2026-10-03');
    $settled = PayoutWorld::payout($shop, PayoutStatus::Settled, '2026-10-02');
    $service = app(PayoutHoldService::class);

    expect($service->hold($shop, 'fraud.redeem_rate'))->toBe(1)
        ->and($service->hold($shop, 'fraud.redeem_rate'))->toBe(0)
        ->and($pending->refresh()->status)->toBe(PayoutStatus::Held)
        ->and($settled->refresh()->hold)->toBeFalse()
        ->and(DB::table('activity_log')->where('event', 'payout.held')->count())->toBe(1);
});

it('lets finance release a held payout with a reason', function (): void {
    $shop = HookWorld::shop();
    $payout = PayoutWorld::payout($shop, PayoutStatus::Held, '2026-10-03', hold: true);
    $finance = adminUser('finance');

    $released = app(PayoutHoldService::class)->release($payout, $finance, 'İnceleme tamam, olağan satış.');

    expect($released)
        ->hold->toBeFalse()
        ->hold_reason->toBeNull()
        ->status->toBe(PayoutStatus::Pending);

    $entry = DB::table('activity_log')->where('event', 'payout.released')->sole();
    expect($entry->causer_id)->toBe($finance->id)
        ->and($entry->subject_id)->toBe($payout->id)
        ->and(json_decode((string) $entry->properties, true))->toMatchArray([
            'reason' => 'İnceleme tamam, olağan satış.',
            'previous_reason' => 'fraud.redeem_rate',
        ]);
});

it('refuses a release without the manage-payouts gate', function (): void {
    $payout = PayoutWorld::payout(HookWorld::shop(), PayoutStatus::Held, '2026-10-03', hold: true);

    expect(fn () => app(PayoutHoldService::class)->release($payout, adminUser('moderator'), 'neden'))
        ->toThrow(AuthorizationException::class)
        ->and(fn () => app(PayoutHoldService::class)->release($payout, HookWorld::merchant(), 'neden'))
        ->toThrow(AuthorizationException::class)
        ->and($payout->refresh()->hold)->toBeTrue();
});

it('refuses a release without a reason or of a payout that is not held', function (): void {
    $finance = adminUser('finance');
    $held = PayoutWorld::payout(HookWorld::shop(), PayoutStatus::Held, '2026-10-03', hold: true);
    $free = PayoutWorld::payout(HookWorld::shop(), PayoutStatus::Pending, '2026-10-03');

    expect(fn () => app(PayoutHoldService::class)->release($held, $finance, '   '))->toThrow(InvalidArgumentException::class)
        ->and(fn () => app(PayoutHoldService::class)->release($free, $finance, 'neden'))->toThrow(PayoutNotHeld::class)
        ->and($held->refresh()->hold)->toBeTrue();
});
