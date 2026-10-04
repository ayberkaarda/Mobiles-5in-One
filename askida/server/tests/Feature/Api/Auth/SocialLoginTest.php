<?php

use App\Domain\Auth\Enums\IdentityProvider;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Unit\Auth\Support\IdentityTokenFactory;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    $this->idp = new IdentityTokenFactory;
    $this->idp->install();
});

/**
 * @param  array<string, mixed>  $claims
 * @param  array<string, mixed>  $extra
 * @return array<string, mixed>
 */
function socialPayload(IdentityTokenFactory $idp, IdentityProvider $provider, string $nonce, array $claims, array $extra = []): array
{
    return array_merge([
        'id_token' => $idp->sign(IdentityTokenFactory::claims($provider, $nonce, $claims)),
        'nonce' => $nonce,
        'device_name' => AuthTestKit::DEVICE,
        'platform' => 'ios',
    ], $extra);
}

it('creates an account on the first Apple sign-in with no password', function (): void {
    $nonce = IdentityTokenFactory::nonce();
    $sub = 'apple-'.bin2hex(random_bytes(5));

    $response = $this->postJson('/api/v1/auth/apple', socialPayload(
        $this->idp,
        IdentityProvider::Apple,
        $nonce,
        ['sub' => $sub, 'email' => 'Fresh@Example.test'],
        ['name' => 'Ayşe Demir', 'kind' => 'donor', 'kvkk_text_version' => AuthTestKit::KVKK_VERSION],
    ));

    $response->assertCreated()
        ->assertJsonPath('abilities', ['donor'])
        ->assertJsonPath('user.email', 'fresh@example.test')
        ->assertJsonPath('user.name', 'Ayşe Demir')
        ->assertJsonPath('user.email_verified', true);

    expect($response->getContent())->not->toContain($sub);

    $user = User::query()->where('apple_sub', $sub)->sole();
    expect($user->password)->toBeNull()
        ->and(DB::table('kvkk_consents')->where('user_id', $user->id)->value('text_version'))->toBe(AuthTestKit::KVKK_VERSION);
});

it('signs the same Apple subject in again without creating another account', function (): void {
    $user = User::factory()->appleOnly()->create();

    $this->postJson('/api/v1/auth/apple', socialPayload(
        $this->idp,
        IdentityProvider::Apple,
        IdentityTokenFactory::nonce(),
        ['sub' => $user->apple_sub, 'email' => $user->email],
    ))->assertOk()->assertJsonPath('user.id', $user->id);

    expect(User::query()->count())->toBe(1);
});

it('links Google to an existing password account when Google verified the email', function (): void {
    $user = User::factory()->create();
    $sub = 'google-'.bin2hex(random_bytes(5));

    $this->postJson('/api/v1/auth/google', socialPayload(
        $this->idp,
        IdentityProvider::Google,
        IdentityTokenFactory::nonce(),
        ['sub' => $sub, 'email' => $user->email, 'email_verified' => true],
    ))->assertOk()->assertJsonPath('user.id', $user->id);

    $fresh = $user->fresh();
    expect($fresh?->google_sub)->toBe($sub)
        ->and($fresh?->password)->toBe($user->password);
});

it('refuses to link when the provider did not verify the email', function (): void {
    $user = User::factory()->create();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/google', socialPayload(
            $this->idp,
            IdentityProvider::Google,
            IdentityTokenFactory::nonce(),
            ['email' => $user->email, 'email_verified' => false],
        )),
        409,
        'conflict',
    );

    expect($user->fresh()?->google_sub)->toBeNull();
});

it('refuses to link when the account already has another subject of that provider', function (): void {
    $user = User::factory()->googleOnly()->create();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/google', socialPayload(
            $this->idp,
            IdentityProvider::Google,
            IdentityTokenFactory::nonce(),
            ['sub' => 'google-other', 'email' => $user->email],
        )),
        409,
        'conflict',
    );
});

it('drops the password and tokens of an unverified account it links to', function (): void {
    $squatter = User::factory()->unverified()->create();
    $oldToken = AuthTestKit::token($squatter, 'old-device');

    $this->postJson('/api/v1/auth/apple', socialPayload(
        $this->idp,
        IdentityProvider::Apple,
        IdentityTokenFactory::nonce(),
        ['email' => $squatter->email, 'email_verified' => 'true'],
    ))->assertOk()->assertJsonPath('user.email_verified', true);

    $fresh = $squatter->fresh();
    expect($fresh?->password)->toBeNull()
        ->and($fresh?->tokens()->pluck('name')->all())->toBe([AuthTestKit::DEVICE]);

    AuthTestKit::forgetGuards();
    $this->withToken($oldToken)->getJson('/api/v1/me')->assertUnauthorized();
});

it('requires kind and the KVKK version when the sign-in creates the account', function (): void {
    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/google', socialPayload($this->idp, IdentityProvider::Google, IdentityTokenFactory::nonce(), [])),
        422,
        'validation.failed',
        [['field' => 'kind', 'code' => 'required'], ['field' => 'kvkk_text_version', 'code' => 'required']],
    );

    expect(User::query()->count())->toBe(0);
});

it('refuses a deactivated account like bad credentials', function (): void {
    $user = User::factory()->googleOnly()->deactivated()->create();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/google', socialPayload(
            $this->idp,
            IdentityProvider::Google,
            IdentityTokenFactory::nonce(),
            ['sub' => $user->google_sub, 'email' => $user->email],
        )),
        401,
        'auth.invalid_credentials',
    );
    expect($user->tokens()->count())->toBe(0);
});

it('rejects an identity token for another audience', function (): void {
    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/google', socialPayload(
            $this->idp,
            IdentityProvider::Google,
            IdentityTokenFactory::nonce(),
            ['aud' => 'someone-else'],
            ['kind' => 'donor', 'kvkk_text_version' => AuthTestKit::KVKK_VERSION],
        )),
        401,
        'auth.token_invalid',
    );
});

it('rejects an Apple token whose nonce was not hashed from the request nonce', function (): void {
    $nonce = IdentityTokenFactory::nonce();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/apple', socialPayload(
            $this->idp,
            IdentityProvider::Apple,
            $nonce,
            ['nonce' => $nonce],
            ['kind' => 'donor', 'kvkk_text_version' => AuthTestKit::KVKK_VERSION],
        )),
        401,
        'auth.token_invalid',
    );
});

it('rejects each invalid field with only its name and rule code', function (array $payload, string $field, string $code): void {
    $base = [
        'id_token' => 'a.b.c',
        'nonce' => IdentityTokenFactory::nonce(),
        'device_name' => 'd',
        'platform' => 'ios',
    ];

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/google', array_filter(array_merge($base, $payload), fn ($v) => $v !== null)),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );
})->with([
    'id token missing' => [['id_token' => null], 'id_token', 'required'],
    'id token too long' => [['id_token' => str_repeat('a', 8193)], 'id_token', 'max'],
    'nonce missing' => [['nonce' => null], 'nonce', 'required'],
    'nonce too short' => [['nonce' => 'short'], 'nonce', 'min'],
    'device missing' => [['device_name' => null], 'device_name', 'required'],
    'platform unknown' => [['platform' => 'web'], 'platform', 'in'],
    'kind unknown' => [['kind' => 'anon'], 'kind', 'enum'],
    'name too long' => [['name' => str_repeat('n', 101)], 'name', 'max'],
    'kvkk malformed' => [['kvkk_text_version' => 'a b'], 'kvkk_text_version', 'regex'],
]);
