<?php

use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

function loginPayload(string $email, string $password, string $device = AuthTestKit::DEVICE): array
{
    return ['email' => $email, 'password' => $password, 'device_name' => $device, 'platform' => 'ios'];
}

it('logs in with email and password and returns a token with the kind ability', function (): void {
    $user = User::factory()->merchant()->create();

    $this->postJson('/api/v1/auth/login', loginPayload($user->email, UserFactory::PASSWORD))
        ->assertOk()
        ->assertJsonPath('token_type', 'Bearer')
        ->assertJsonPath('abilities', ['merchant'])
        ->assertJsonPath('user.id', $user->id)
        ->assertJsonPath('user.email_verified', true);
});

it('accepts the email in any letter case', function (): void {
    $user = User::factory()->create(['email' => 'lower@example.test']);

    $this->postJson('/api/v1/auth/login', loginPayload('LOWER@Example.test', UserFactory::PASSWORD))
        ->assertOk()
        ->assertJsonPath('user.id', $user->id);
});

it('lets unverified users log in and reports email_verified false', function (): void {
    $user = User::factory()->unverified()->create();

    $this->postJson('/api/v1/auth/login', loginPayload($user->email, UserFactory::PASSWORD))
        ->assertOk()
        ->assertJsonPath('user.email_verified', false);
});

it('answers wrong password, unknown email, deactivated and provider-only accounts identically', function (): void {
    $active = User::factory()->create();
    $deactivated = User::factory()->deactivated()->create();
    $appleOnly = User::factory()->appleOnly()->create();

    $responses = [
        $this->postJson('/api/v1/auth/login', loginPayload($active->email, 'wrong-'.AuthTestKit::password())),
        $this->postJson('/api/v1/auth/login', loginPayload('nobody@example.test', UserFactory::PASSWORD)),
        $this->postJson('/api/v1/auth/login', loginPayload($deactivated->email, UserFactory::PASSWORD)),
        $this->postJson('/api/v1/auth/login', loginPayload($appleOnly->email, UserFactory::PASSWORD)),
    ];

    $bodies = [];
    foreach ($responses as $response) {
        AuthTestKit::assertProblem($response, 401, 'auth.invalid_credentials');
        $body = $response->json();
        unset($body['request_id']);
        $bodies[] = $body;
    }

    expect(array_unique(array_map('json_encode', $bodies)))->toHaveCount(1)
        ->and(User::query()->withCount('tokens')->get()->sum('tokens_count'))->toBe(0);
});

it('keeps one token per device name and revokes the previous one', function (): void {
    $user = User::factory()->create();

    $first = $this->postJson('/api/v1/auth/login', loginPayload($user->email, UserFactory::PASSWORD))->json('token');
    $second = $this->postJson('/api/v1/auth/login', loginPayload($user->email, UserFactory::PASSWORD))->json('token');
    $this->postJson('/api/v1/auth/login', loginPayload($user->email, UserFactory::PASSWORD, 'ipad'))->assertOk();

    expect($user->tokens()->count())->toBe(2)
        ->and($user->tokens()->pluck('name')->sort()->values()->all())->toBe(['ipad', AuthTestKit::DEVICE]);

    AuthTestKit::forgetGuards();
    $this->withToken($first)->getJson('/api/v1/me')->assertUnauthorized();

    AuthTestKit::forgetGuards();
    $this->withToken($second)->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.id', $user->id);
});

it('rehashes a password stored with weaker parameters on login', function (): void {
    $weak = Hash::driver('argon2id')->make(UserFactory::PASSWORD, ['memory' => 512, 'time' => 1, 'threads' => 1]);
    $user = User::factory()->create();
    $user->forceFill(['password' => $weak])->saveQuietly();

    $this->postJson('/api/v1/auth/login', loginPayload($user->email, UserFactory::PASSWORD))->assertOk();

    expect($user->fresh()?->password)->not->toBe($weak)->toStartWith('$argon2id$');
});

it('rejects each invalid login field with only its name and rule code', function (array $payload, string $field, string $code): void {
    $base = loginPayload('someone@example.test', AuthTestKit::password());
    $payload = array_filter(array_merge($base, $payload), fn ($value) => $value !== null);

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/login', $payload),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );
})->with([
    'email missing' => [['email' => null], 'email', 'required'],
    'email malformed' => [['email' => 'nope'], 'email', 'email'],
    'password missing' => [['password' => null], 'password', 'required'],
    'password too long' => [['password' => str_repeat('p', 129)], 'password', 'max'],
    'device name missing' => [['device_name' => null], 'device_name', 'required'],
    'platform unknown' => [['platform' => 'symbian'], 'platform', 'in'],
]);
