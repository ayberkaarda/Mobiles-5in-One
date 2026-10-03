<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

it('returns the token owner without credentials or provider subjects', function (): void {
    $user = User::factory()->merchant()->create(['apple_sub' => 'apple-subject-'.bin2hex(random_bytes(4))]);

    $response = $this->withToken(AuthTestKit::token($user))->getJson('/api/v1/me');

    $response->assertOk()->assertExactJson(['data' => [
        'id' => $user->id,
        'email' => $user->email,
        'name' => $user->name,
        'kind' => 'merchant',
        'email_verified' => true,
    ]]);

    expect($response->getContent())
        ->not->toContain((string) $user->apple_sub)
        ->not->toContain('password')
        ->not->toContain('$argon2id$');
});

it('requires authentication', function (): void {
    $this->getJson('/api/v1/me')->assertUnauthorized();
    $this->patchJson('/api/v1/me', ['name' => 'X'])->assertUnauthorized();
});

it('never shows another user to a token', function (): void {
    $alice = User::factory()->create();
    $bob = User::factory()->create();

    $this->withToken(AuthTestKit::token($alice))->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.id', $alice->id)
        ->assertJsonMissing(['id' => $bob->id]);
});

it('updates the name', function (): void {
    $user = User::factory()->create(['name' => 'Eski Ad']);

    $this->withToken(AuthTestKit::token($user))->patchJson('/api/v1/me', ['name' => '  Yeni Ad  '])
        ->assertOk()
        ->assertJsonPath('data.name', 'Yeni Ad');

    expect($user->fresh()?->name)->toBe('Yeni Ad');
});

it('refuses to change protected fields', function (string $field, mixed $value): void {
    $user = User::factory()->donor()->unverified()->create();
    $before = $user->fresh()?->getAttributes();

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($user))->patchJson('/api/v1/me', [$field => $value]),
        422,
        'validation.failed',
        [['field' => $field, 'code' => 'prohibited']],
    );

    expect($user->fresh()?->getAttributes())->toBe($before);
})->with([
    'kind' => ['kind', 'merchant'],
    'email' => ['email', 'other@example.test'],
    'password' => ['password', 'replacement-pass-phrase'],
    'apple_sub' => ['apple_sub', 'apple-x'],
    'google_sub' => ['google_sub', 'google-x'],
    'email_verified_at' => ['email_verified_at', '2026-01-01T00:00:00Z'],
    'deactivated_at' => ['deactivated_at', '2026-01-01T00:00:00Z'],
]);

it('validates the name', function (mixed $name, string $code): void {
    $user = User::factory()->create();

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($user))->patchJson('/api/v1/me', ['name' => $name]),
        422,
        'validation.failed',
        [['field' => 'name', 'code' => $code]],
    );
})->with([
    'empty' => ['', 'required'],
    'too long' => [str_repeat('a', 101), 'max'],
    'not a string' => [['a'], 'string'],
]);
