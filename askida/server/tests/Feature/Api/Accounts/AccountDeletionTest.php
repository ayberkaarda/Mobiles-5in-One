<?php

use App\Domain\Accounts\Mail\AccountDeletionRequestedMail;
use App\Domain\Accounts\Services\AccountDeletionService;
use App\Domain\Auth\Enums\IdentityProvider;
use App\Domain\Auth\Models\DeletionRequest;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Unit\Auth\Support\IdentityTokenFactory;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    $this->idp = new IdentityTokenFactory;
    $this->idp->install();
});

function pushTokenFor(User $user): void
{
    $row = new DevicePushToken(['platform' => 'ios', 'token' => 'reg-'.bin2hex(random_bytes(16))]);
    $row->user_id = $user->id;
    $row->save();
}

/**
 * @return array<string, string>
 */
function reauthWithIdToken(IdentityTokenFactory $idp, IdentityProvider $provider, string $sub): array
{
    $nonce = IdentityTokenFactory::nonce();

    return [
        'provider' => $provider->value,
        'id_token' => $idp->sign(IdentityTokenFactory::claims($provider, $nonce, ['sub' => $sub])),
        'nonce' => $nonce,
    ];
}

it('deactivates a password account at once, revokes every token and schedules the hard delete', function (): void {
    Carbon::setTestNow('2026-10-04 12:00:00');
    $user = User::factory()->create();
    $token = AuthTestKit::token($user);
    AuthTestKit::token($user, 'second-device');
    pushTokenFor($user);

    $response = $this->withToken($token)->deleteJson('/api/v1/me', ['password' => UserFactory::PASSWORD]);

    $response->assertStatus(202)->assertExactJson([
        'status' => 'pending',
        'grace_until' => Carbon::parse('2026-10-11 12:00:00')->toIso8601String(),
    ]);

    $user->refresh();
    $deletion = DeletionRequest::query()->sole();

    expect($user->deactivated_at)->not->toBeNull()
        ->and($user->tokens()->count())->toBe(0)
        ->and(DevicePushToken::query()->where('user_id', $user->id)->count())->toBe(0)
        ->and($deletion->user_id)->toBe($user->id)
        ->and($deletion->status->value)->toBe('pending')
        ->and($deletion->channel->value)->toBe('app')
        ->and($deletion->grace_until->equalTo(Carbon::parse('2026-10-11 12:00:00')))->toBeTrue();

    Mail::assertQueued(AccountDeletionRequestedMail::class, fn (AccountDeletionRequestedMail $mail): bool => $mail->hasTo($user->email));

    // The revoked token no longer works.
    AuthTestKit::forgetGuards();
    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
    Carbon::setTestNow();
});

it('renders the Turkish confirmation mail with the end of the grace period', function (): void {
    $mail = new AccountDeletionRequestedMail('Deniz', Carbon::parse('2026-10-11 12:00:00')->toImmutable());

    $mail->assertSeeInHtml('Hesap silme talebin alındı')
        ->assertSeeInHtml('11.10.2026 12:00')
        ->assertSeeInText('kalıcı olarak silinir');
    expect($mail->envelope()->subject)->toBe('Askıda hesap silme talebin alındı');
});

it('requires re-authentication', function (array $body, int $status, string $code): void {
    $user = User::factory()->create();

    AuthTestKit::assertProblem($this->withToken(AuthTestKit::token($user))->deleteJson('/api/v1/me', $body), $status, $code);

    expect($user->fresh()?->deactivated_at)->toBeNull()
        ->and(DeletionRequest::query()->count())->toBe(0);
    Mail::assertNothingQueued();
})->with([
    'missing password' => [[], 422, 'validation.failed'],
    'wrong password' => [['password' => 'not-the-'.bin2hex(random_bytes(4))], 401, 'auth.invalid_credentials'],
]);

it('requires a fresh provider token of the same subject for an Apple account', function (): void {
    $user = User::factory()->appleOnly()->create();
    $token = AuthTestKit::token($user);
    // Seven attempts in one test: clear the shared sign-in limiter between them.

    // Missing proof, password instead of a token, and a token of another subject.
    AuthTestKit::resetLimits();
    AuthTestKit::assertProblem($this->withToken($token)->deleteJson('/api/v1/me'), 422, 'validation.failed', [['field' => 'id_token', 'code' => 'required']]);
    AuthTestKit::resetLimits();
    AuthTestKit::assertProblem($this->withToken($token)->deleteJson('/api/v1/me', ['password' => UserFactory::PASSWORD]), 422, 'validation.failed');
    AuthTestKit::resetLimits();
    AuthTestKit::assertProblem(
        $this->withToken($token)->deleteJson('/api/v1/me', reauthWithIdToken($this->idp, IdentityProvider::Apple, 'apple-other-'.bin2hex(random_bytes(3)))),
        401,
        'auth.invalid_credentials',
    );

    // A token for the other provider, an expired token and a nonce mismatch.
    AuthTestKit::resetLimits();
    AuthTestKit::assertProblem(
        $this->withToken($token)->deleteJson('/api/v1/me', reauthWithIdToken($this->idp, IdentityProvider::Google, (string) $user->apple_sub)),
        401,
        'auth.invalid_credentials',
    );
    $nonce = IdentityTokenFactory::nonce();
    AuthTestKit::resetLimits();
    AuthTestKit::assertProblem($this->withToken($token)->deleteJson('/api/v1/me', [
        'provider' => 'apple',
        'id_token' => $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Apple, $nonce, ['sub' => $user->apple_sub, 'exp' => Carbon::now()->subMinutes(5)->getTimestamp()])),
        'nonce' => $nonce,
    ]), 401, 'auth.token_invalid');
    AuthTestKit::resetLimits();
    AuthTestKit::assertProblem($this->withToken($token)->deleteJson('/api/v1/me', [
        'provider' => 'apple',
        'id_token' => $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Apple, $nonce, ['sub' => $user->apple_sub])),
        'nonce' => IdentityTokenFactory::nonce(),
    ]), 401, 'auth.token_invalid');

    expect($user->fresh()?->deactivated_at)->toBeNull();

    AuthTestKit::resetLimits();
    $this->withToken($token)
        ->deleteJson('/api/v1/me', reauthWithIdToken($this->idp, IdentityProvider::Apple, (string) $user->apple_sub))
        ->assertStatus(202);

    expect($user->fresh()?->deactivated_at)->not->toBeNull();
});

it('accepts a Google token for a Google account', function (): void {
    $user = User::factory()->googleOnly()->create();

    $this->withToken(AuthTestKit::token($user))
        ->deleteJson('/api/v1/me', reauthWithIdToken($this->idp, IdentityProvider::Google, (string) $user->google_sub))
        ->assertStatus(202);

    expect(DeletionRequest::query()->where('user_id', $user->id)->count())->toBe(1);
});

it('refuses a merchant whose solely owned shop has open units', function (HookStatus $status): void {
    $merchant = User::factory()->merchant()->create();
    $shop = AccountsWorld::shop($merchant);
    AccountsWorld::hook(AccountsWorld::donation(null, AccountsWorld::item($shop)), $status);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($merchant))->deleteJson('/api/v1/me', ['password' => UserFactory::PASSWORD]),
        409,
        'shop.has_open_hooks',
    );

    expect($merchant->fresh()?->deactivated_at)->toBeNull()
        ->and($merchant->tokens()->count())->toBe(1)
        ->and(DeletionRequest::query()->count())->toBe(0);
})->with([HookStatus::Available, HookStatus::Reserved]);

it('lets a merchant go when the shops have only redeemed units or a co-owner remains', function (): void {
    $merchant = User::factory()->merchant()->create();
    $closed = AccountsWorld::shop($merchant);
    AccountsWorld::hook(AccountsWorld::donation(null, AccountsWorld::item($closed)), HookStatus::Redeemed);

    $coOwned = AccountsWorld::shop($merchant);
    AccountsWorld::member($coOwned, User::factory()->merchant()->create(), ShopMemberRole::Owner);
    AccountsWorld::hook(AccountsWorld::donation(null, AccountsWorld::item($coOwned)), HookStatus::Available);

    $this->withToken(AuthTestKit::token($merchant))
        ->deleteJson('/api/v1/me', ['password' => UserFactory::PASSWORD])
        ->assertStatus(202);
});

it('requires a user token', function (): void {
    AuthTestKit::assertProblem($this->deleteJson('/api/v1/me', ['password' => AuthTestKit::password()]), 401, 'auth.unauthenticated');
});

it('cancels the request and reactivates on a password sign-in during the grace period', function (): void {
    $user = User::factory()->create();
    $this->withToken(AuthTestKit::token($user))->deleteJson('/api/v1/me', ['password' => UserFactory::PASSWORD])->assertStatus(202);
    AuthTestKit::forgetGuards();

    Carbon::setTestNow(Carbon::now()->addDays(6));

    $this->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => UserFactory::PASSWORD,
        'device_name' => AuthTestKit::DEVICE,
        'platform' => 'ios',
    ])->assertOk()->assertJsonPath('user.id', $user->id);

    $deletion = DeletionRequest::query()->sole();
    expect($user->fresh()?->deactivated_at)->toBeNull()
        ->and($deletion->status->value)->toBe('cancelled')
        ->and($deletion->cancelled_at)->not->toBeNull();
    Carbon::setTestNow();
});

it('keeps the account closed for a wrong password, after the grace period and for an admin deactivation', function (): void {
    $user = User::factory()->create();
    $this->withToken(AuthTestKit::token($user))->deleteJson('/api/v1/me', ['password' => UserFactory::PASSWORD])->assertStatus(202);
    AuthTestKit::forgetGuards();

    $login = fn (User $who, string $password) => $this->postJson('/api/v1/auth/login', [
        'email' => $who->email,
        'password' => $password,
        'device_name' => AuthTestKit::DEVICE,
        'platform' => 'ios',
    ]);

    AuthTestKit::assertProblem($login($user, 'wrong-'.bin2hex(random_bytes(4))), 401, 'auth.invalid_credentials');
    expect($user->fresh()?->deactivated_at)->not->toBeNull();

    Carbon::setTestNow(Carbon::now()->addDays(AccountDeletionService::GRACE_DAYS)->addMinute());
    AuthTestKit::assertProblem($login($user, UserFactory::PASSWORD), 401, 'auth.invalid_credentials');
    expect(DeletionRequest::query()->sole()->status->value)->toBe('pending');
    Carbon::setTestNow();

    $closed = User::factory()->deactivated()->create();
    AuthTestKit::assertProblem($login($closed, UserFactory::PASSWORD), 401, 'auth.invalid_credentials');
    expect($closed->fresh()?->deactivated_at)->not->toBeNull();
});

it('cancels the request on an Apple sign-in during the grace period', function (): void {
    $user = User::factory()->appleOnly()->create();
    $this->withToken(AuthTestKit::token($user))
        ->deleteJson('/api/v1/me', reauthWithIdToken($this->idp, IdentityProvider::Apple, (string) $user->apple_sub))
        ->assertStatus(202);
    AuthTestKit::forgetGuards();

    $nonce = IdentityTokenFactory::nonce();
    $this->postJson('/api/v1/auth/apple', [
        'id_token' => $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Apple, $nonce, ['sub' => $user->apple_sub, 'email' => $user->email])),
        'nonce' => $nonce,
        'device_name' => AuthTestKit::DEVICE,
        'platform' => 'ios',
    ])->assertOk();

    expect($user->fresh()?->deactivated_at)->toBeNull()
        ->and(DeletionRequest::query()->sole()->status->value)->toBe('cancelled');
});
