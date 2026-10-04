<?php

use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| GET /api/v1/shops/{shop}/redemptions?day= (rule AN-2): item, time and redeemer role
| only, for owner and staff of the shop.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
});

function redemptionsCall(Shop $shop, ?string $token, ?string $day = null): TestResponse
{
    app('auth')->forgetGuards();
    $query = $day === null ? '' : '?day='.$day;

    return test()->getJson("/api/v1/shops/{$shop->id}/redemptions{$query}", $token === null ? [] : ['Authorization' => 'Bearer '.$token]);
}

function redeemedAt(Shop $shop, User $by, CarbonImmutable $at, string $itemName = 'Ekmek'): void
{
    $item = HookWorld::item($shop, name: $itemName);
    [$hook] = HookWorld::availableHooks($item, 1);
    HookWorld::reserve($hook, HookWorld::anon(), HookWorld::newCode(), $at->subMinutes(2));
    DB::table('hooks')->where('id', $hook->id)->update([
        'status' => 'REDEEMED',
        'redeemed_at' => $at->format('Y-m-d H:i:s.uP'),
        'redeemed_by_user_id' => $by->id,
    ]);
}

it('lists the day\'s redemptions with item, time and role only', function (): void {
    $shop = HookWorld::shop();
    $owner = HookWorld::owner($shop);
    $staff = HookWorld::staff($shop);
    redeemedAt($shop, $owner, CarbonImmutable::parse('2026-10-04 09:00:00', 'Europe/Istanbul'), 'Ekmek');
    redeemedAt($shop, $staff, CarbonImmutable::parse('2026-10-04 11:30:00', 'Europe/Istanbul'), 'Mercimek çorbası');
    // Another day and another shop are left out.
    redeemedAt($shop, $owner, CarbonImmutable::parse('2026-10-03 23:59:00', 'Europe/Istanbul'));
    redeemedAt(HookWorld::shop(), $owner, CarbonImmutable::parse('2026-10-04 10:00:00', 'Europe/Istanbul'));

    foreach ([$owner, $staff] as $member) {
        $response = redemptionsCall($shop, HookWorld::userToken($member, 'list-'.$member->id));

        $response->assertOk();
        expect($response->json('meta'))->toBe(['day' => '2026-10-04', 'count' => 2])
            ->and($response->json('data'))->toHaveCount(2)
            ->and($response->json('data.0.item.name'))->toBe('Mercimek çorbası')
            ->and($response->json('data.0.redeemed_by_role'))->toBe('staff')
            ->and($response->json('data.1.redeemed_by_role'))->toBe('owner');

        foreach ($response->json('data') as $row) {
            expect(array_keys($row))->toBe(['item', 'redeemed_at', 'redeemed_by_role'])
                ->and(array_keys($row['item']))->toBe(['name']);
        }

        $body = (string) $response->getContent();
        foreach (DB::table('hooks')->whereNotNull('code_hash')->pluck('code_hash') as $hash) {
            expect($body)->not->toContain((string) $hash);
        }
        foreach (DB::table('anon_devices')->pluck('anon_id') as $anonId) {
            expect($body)->not->toContain((string) $anonId);
        }
        expect($body)->not->toContain('reserved_at')->not->toContain($owner->email)->not->toContain($staff->email);
    }

    $yesterday = redemptionsCall($shop, HookWorld::userToken($owner, 'yesterday'), '2026-10-03');
    expect($yesterday->json('meta.count'))->toBe(1);
});

it('refuses outsiders with 404, donors with 403 and bad days with 422', function (): void {
    $shop = HookWorld::shop();
    $outsider = HookWorld::merchant();

    expect(redemptionsCall($shop, HookWorld::userToken($outsider))->status())->toBe(404)
        ->and(redemptionsCall($shop, HookWorld::userToken(HookWorld::donor()))->json('code'))->toBe('forbidden')
        ->and(redemptionsCall($shop, HookWorld::anonToken(HookWorld::anon()))->status())->toBe(401)
        ->and(redemptionsCall($shop, null)->status())->toBe(401);

    $bad = redemptionsCall($shop, HookWorld::userToken(HookWorld::owner($shop)), '04-10-2026');
    $bad->assertStatus(422);
    expect($bad->json('errors'))->toBe([['field' => 'day', 'code' => 'date_format']]);
});
