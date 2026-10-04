<?php

use App\Domain\Anon\Models\AnonDevice;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| Anon tokens work only on routes that demand the anon ability; user tokens keep the
| Phase 1 rule (exactly the ability of users.kind).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
});

function bearerCall(string $method, string $uri, ?string $token, array $body = []): TestResponse
{
    app('auth')->forgetGuards();

    return test()->json($method, $uri, $body, $token === null ? [] : ['Authorization' => 'Bearer '.$token]);
}

it('refuses anon tokens on user routes with the usual 401', function (string $method, string $uri): void {
    $token = HookWorld::anonToken(HookWorld::anon());
    $shop = HookWorld::shop();

    $response = bearerCall($method, str_replace('{shop}', $shop->id, $uri), $token, ['name' => 'Yeni', 'code' => 'ABCDEFGH']);

    $response->assertStatus(401);
    expect($response->json('code'))->toBe('auth.unauthenticated');
})->with([
    'GET me' => ['GET', '/api/v1/me'],
    'PATCH me' => ['PATCH', '/api/v1/me'],
    'POST auth/logout' => ['POST', '/api/v1/auth/logout'],
    'POST redeem' => ['POST', '/api/v1/shops/{shop}/redeem'],
    'GET redemptions' => ['GET', '/api/v1/shops/{shop}/redemptions'],
]);

it('keeps user tokens working on user routes and away from anon routes', function (): void {
    $donor = HookWorld::donor();
    $token = HookWorld::userToken($donor);

    bearerCall('GET', '/api/v1/me', $token)->assertOk()->assertJsonPath('data.id', $donor->id);

    $anonRoute = bearerCall('DELETE', '/api/v1/anon/me', $token);
    $anonRoute->assertForbidden();
    expect($anonRoute->json('code'))->toBe('forbidden');
});

it('refuses anon tokens that are expired, forged or of a banned device', function (): void {
    $device = HookWorld::anon();

    $forged = $device->createToken('forged', ['anon', 'donor'], now()->addDay())->plainTextToken;
    $wildcard = $device->createToken('wildcard', ['*'], now()->addDay())->plainTextToken;
    $noExpiry = $device->createToken('no-expiry', ['anon'])->plainTextToken;
    $expired = $device->createToken('expired', ['anon'], now()->subMinute())->plainTextToken;

    foreach ([$forged, $wildcard, $noExpiry, $expired] as $token) {
        expect(bearerCall('DELETE', '/api/v1/anon/me', $token)->status())->toBe(401);
    }

    $valid = HookWorld::anonToken($device);
    $device->forceFill(['banned_at' => now()])->save();
    expect(bearerCall('DELETE', '/api/v1/anon/me', $valid)->json('code'))->toBe('auth.unauthenticated')
        ->and(AnonDevice::query()->whereKey($device->id)->exists())->toBeTrue();
});

it('expires anon tokens after 30 days', function (): void {
    $device = HookWorld::anon();
    $token = HookWorld::anonToken($device);

    $this->travel(30)->days();
    $this->travel(1)->minutes();

    expect(bearerCall('DELETE', '/api/v1/anon/me', $token)->status())->toBe(401)
        ->and(AnonDevice::query()->whereKey($device->id)->exists())->toBeTrue();
});

it('never attributes an anon request to the device in the access log', function (): void {
    $lines = [];
    Log::listen(function (MessageLogged $event) use (&$lines): void {
        if ($event->message === 'http.request') {
            $lines[] = $event->context;
        }
    });
    $device = HookWorld::anon();

    bearerCall('DELETE', '/api/v1/anon/me', HookWorld::anonToken($device))->assertNoContent();

    expect($lines)->toHaveCount(1)
        ->and($lines[0]['user_id'])->toBeNull()
        ->and(json_encode($lines[0]))->not->toContain($device->anon_id)->not->toContain($device->id);
});
