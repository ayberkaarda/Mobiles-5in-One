<?php

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Hooks\Models\HookStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| DELETE /api/v1/anon/me ("Verilerimi sıfırla", security item 21, rule AN-6).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
});

it('erases the device, its tokens and counters and gives back its reservations', function (): void {
    $nonce = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    $attest = $this->postJson('/api/v1/anon/attest', ['platform' => 'android', 'token' => 'attestation-ok', 'device_nonce' => $nonce]);
    $token = (string) $attest->json('token');
    $device = AnonDevice::query()->sole();

    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$reserved, $redeemed, $untouched] = HookWorld::availableHooks($item, 3);
    $other = HookWorld::anon();
    HookWorld::reserve($reserved, $device, HookWorld::newCode());
    HookWorld::reserve($redeemed, $device, HookWorld::newCode());
    HookWorld::reserve($untouched, $other, HookWorld::newCode());
    DB::table('hooks')->where('id', $redeemed->id)->update([
        'status' => 'REDEEMED',
        'redeemed_at' => now(),
        'redeemed_by_user_id' => HookWorld::owner($shop)->id,
    ]);
    (new AnonDailyCounter)->forceFill(['anon_id' => $device->anon_id, 'day' => now()->toDateString(), 'count' => 2, 'per_shop' => [$shop->id => 2]])->save();
    (new AnonDailyCounter)->forceFill(['anon_id' => $other->anon_id, 'day' => now()->toDateString(), 'count' => 1, 'per_shop' => [$shop->id => 1]])->save();

    app('auth')->forgetGuards();
    $this->deleteJson('/api/v1/anon/me', [], ['Authorization' => 'Bearer '.$token])->assertNoContent();

    expect(AnonDevice::query()->whereKey($device->id)->exists())->toBeFalse()
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $device->id)->count())->toBe(0)
        ->and(AnonDailyCounter::query()->where('anon_id', $device->anon_id)->count())->toBe(0)
        ->and(AnonDailyCounter::query()->where('anon_id', $other->anon_id)->count())->toBe(1);

    $released = $reserved->fresh();
    expect($released?->status)->toBe(HookStatus::Available)
        ->and($released?->anon_id)->toBeNull()
        ->and($released?->code_hash)->toBeNull()
        ->and($released?->reserved_at)->toBeNull()
        ->and($released?->expires_at)->toBeNull();

    expect($redeemed->fresh()?->status)->toBe(HookStatus::Redeemed)
        ->and($redeemed->fresh()?->anon_id)->toBeNull()
        ->and($untouched->fresh()?->anon_id)->toBe($other->anon_id)
        ->and(DB::table('hooks')->where('anon_id', $device->anon_id)->count())->toBe(0);

    // The token is gone and the same install starts over with a new anon id.
    app('auth')->forgetGuards();
    $this->deleteJson('/api/v1/anon/me', [], ['Authorization' => 'Bearer '.$token])->assertStatus(401);

    $this->postJson('/api/v1/anon/attest', ['platform' => 'android', 'token' => 'attestation-ok', 'device_nonce' => $nonce])->assertOk();
    expect(AnonDevice::query()->where('anon_id', '!=', $other->anon_id)->sole()->anon_id)->not->toBe($device->anon_id);
});

it('lets only an anon token call it', function (): void {
    expect($this->deleteJson('/api/v1/anon/me')->status())->toBe(401);
});
