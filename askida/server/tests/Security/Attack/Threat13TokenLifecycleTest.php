<?php

use App\Domain\Auth\Enums\UserKind;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;

/*
| Token lifecycle (security checklist items 3 and 4). A bearer token is refused once it
| expired, was revoked, carries an ability other than exactly the account kind, belongs
| to a deactivated account, or is an anon device token on a user route; a user token is
| refused on the anon routes. Tokens are stored hashed only.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
});

function attack13Me(?string $token): TestResponse
{
    return AttackKit::json('GET', '/api/v1/me', $token);
}

it('refuses an expired user token and accepts a fresh one', function (): void {
    $donor = HookWorld::donor();
    $expired = HookWorld::userToken($donor, 'old-phone');
    $fresh = HookWorld::userToken($donor, 'new-phone');
    DB::table('personal_access_tokens')->where('id', PersonalAccessToken::findToken($expired)?->id)
        ->update(['expires_at' => CarbonImmutable::now()->subSecond()->toIso8601String()]);

    AttackKit::assertProblem(attack13Me($expired), 401, 'auth.unauthenticated');
    attack13Me($fresh)->assertOk()->assertJsonPath('data.id', $donor->id);
});

it('refuses a token past the configured lifetime even without an expiry date', function (): void {
    $donor = HookWorld::donor();
    $token = $donor->createToken('no-expiry', ['donor'])->plainTextToken;

    attack13Me($token)->assertOk();

    $this->travel((int) config('sanctum.expiration') + 1)->minutes();
    AttackKit::assertProblem(attack13Me($token), 401, 'auth.unauthenticated');
});

it('refuses a revoked token while the other devices keep working', function (): void {
    $donor = HookWorld::donor();
    $phone = HookWorld::userToken($donor, 'phone');
    $tablet = HookWorld::userToken($donor, 'tablet');

    AttackKit::json('POST', '/api/v1/auth/logout', $phone)->assertSuccessful();

    AttackKit::assertProblem(attack13Me($phone), 401, 'auth.unauthenticated');
    attack13Me($tablet)->assertOk();
    expect(PersonalAccessToken::findToken($phone))->toBeNull();
});

it('refuses a token whose abilities are not exactly the account kind', function (array $abilities): void {
    $donor = HookWorld::donor();
    $token = $donor->createToken('forged', $abilities, CarbonImmutable::now()->addDay())->plainTextToken;

    AttackKit::assertProblem(attack13Me($token), 401, 'auth.unauthenticated');
    AttackKit::assertProblem(AttackKit::json('GET', '/api/v1/donations', $token), 401, 'auth.unauthenticated');
})->with([
    'wildcard' => [['*']],
    'other kind' => [['merchant']],
    'anon' => [['anon']],
    'two abilities' => [['donor', 'merchant']],
    'none' => [[]],
]);

it('invalidates older tokens when the account kind changes', function (): void {
    $user = HookWorld::donor();
    $token = HookWorld::userToken($user);
    attack13Me($token)->assertOk();

    DB::table('users')->where('id', $user->id)->update(['kind' => UserKind::Merchant->value]);

    AttackKit::assertProblem(attack13Me($token), 401, 'auth.unauthenticated');
});

it('refuses the tokens of a deactivated account', function (): void {
    $user = HookWorld::donor();
    $token = HookWorld::userToken($user);
    DB::table('users')->where('id', $user->id)->update(['deactivated_at' => CarbonImmutable::now()->toIso8601String()]);

    AttackKit::assertProblem(attack13Me($token), 401, 'auth.unauthenticated');
});

it('refuses an anon device token on every user route', function (string $method, string $uri, array $body): void {
    $token = HookWorld::anonToken(HookWorld::anon());

    AttackKit::assertProblem(AttackKit::json($method, $uri, $token, $body), 401, 'auth.unauthenticated');
})->with([
    ['GET', '/api/v1/me', []],
    ['PATCH', '/api/v1/me', ['name' => 'Anon']],
    ['PUT', '/api/v1/me/push-token', ['platform' => 'android', 'token' => 'push-x']],
    ['DELETE', '/api/v1/me', ['password' => 'x']],
    ['POST', '/api/v1/donations', []],
    ['POST', '/api/v1/shops', []],
    ['POST', '/api/v1/auth/logout', []],
]);

it('refuses a user token on the anon routes', function (string $method, string $uri): void {
    $token = HookWorld::userToken(HookWorld::donor());
    $device = HookWorld::anon();

    $response = AttackKit::json($method, $uri, $token, ['shop_id' => (string) Str::uuid7(), 'item_id' => (string) Str::uuid7()]);

    AttackKit::assertProblem($response, 403, 'forbidden');
    expect($device->fresh())->not->toBeNull();
})->with([
    ['POST', '/api/v1/hooks/reserve'],
    ['DELETE', '/api/v1/anon/me'],
]);

it('refuses an expired anon token and a token of a deleted device', function (): void {
    $device = HookWorld::anon();
    $token = HookWorld::anonToken($device);
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);

    $this->travel((int) config('askida.attestation.token_days', 30))->days();
    $this->travel(1)->minutes();
    AttackKit::assertProblem(AttackKit::json('POST', '/api/v1/hooks/reserve', $token, ['shop_id' => $shop->id, 'item_id' => $item->id]), 401, 'auth.unauthenticated');

    $this->travelBack();
    $other = HookWorld::anon();
    $otherToken = HookWorld::anonToken($other);
    AttackKit::json('DELETE', '/api/v1/anon/me', $otherToken)->assertNoContent();
    AttackKit::assertProblem(AttackKit::json('DELETE', '/api/v1/anon/me', $otherToken), 401, 'auth.unauthenticated');
});

it('stores tokens only as hashes', function (): void {
    $user = HookWorld::donor();
    $plain = HookWorld::userToken($user);
    [, $secret] = explode('|', $plain, 2);

    $stored = DB::table('personal_access_tokens')->where('tokenable_id', $user->id)->sole();
    expect($stored->token)->toBe(hash('sha256', $secret))
        ->and(json_encode($stored))->not->toContain($secret);
});

it('negative control: a donor token of the right kind reaches the donor routes', function (): void {
    $user = HookWorld::donor();
    $token = HookWorld::userToken($user);

    attack13Me($token)->assertOk();
    AttackKit::json('GET', '/api/v1/donations', $token)->assertOk();
    expect(User::query()->findOrFail($user->id)->kind)->toBe(UserKind::Donor);
});
