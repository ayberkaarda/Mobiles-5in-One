<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

it('issues donor tokens with only the donor ability and merchant tokens with only the merchant ability', function (): void {
    $donor = PersonalAccessToken::findToken(AuthTestKit::token(User::factory()->donor()->create()));
    $merchant = PersonalAccessToken::findToken(AuthTestKit::token(User::factory()->merchant()->create()));

    expect($donor?->can('donor'))->toBeTrue()
        ->and($donor?->can('merchant'))->toBeFalse()
        ->and($donor?->can('anon'))->toBeFalse()
        ->and($merchant?->can('merchant'))->toBeTrue()
        ->and($merchant?->can('donor'))->toBeFalse();
});

it('revokes only the presenting token on logout', function (): void {
    $user = User::factory()->create();
    $phone = AuthTestKit::token($user, 'phone');
    $tablet = AuthTestKit::token($user, 'tablet');

    $this->withToken($phone)->postJson('/api/v1/auth/logout')->assertNoContent();

    AuthTestKit::forgetGuards();
    $this->withToken($phone)->getJson('/api/v1/me')->assertUnauthorized();

    AuthTestKit::forgetGuards();
    $this->withToken($tablet)->getJson('/api/v1/me')->assertOk();

    expect($user->tokens()->pluck('name')->all())->toBe(['tablet']);
});

it('requires a token to log out', function (): void {
    $this->postJson('/api/v1/auth/logout')->assertUnauthorized();
});

it('rejects a token after the 30-day expiration', function (): void {
    $token = AuthTestKit::token(User::factory()->create());

    $this->travel(29)->days();
    $this->withToken($token)->getJson('/api/v1/me')->assertOk();

    AuthTestKit::forgetGuards();
    $this->travel(1)->days();
    $this->travel(1)->minutes();
    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
});

it('reads the token lifetime from configuration', function (): void {
    expect(config('sanctum.expiration'))->toBe(43200)
        ->and(config('sanctum.stateful'))->toBe([])
        ->and(config('sanctum.guard'))->toBe([]);
});

it('rejects a malformed or unknown bearer token', function (): void {
    $this->withToken('1|'.bin2hex(random_bytes(20)))->getJson('/api/v1/me')->assertUnauthorized();

    AuthTestKit::forgetGuards();
    $this->withToken('garbage')->getJson('/api/v1/me')->assertUnauthorized();
});
