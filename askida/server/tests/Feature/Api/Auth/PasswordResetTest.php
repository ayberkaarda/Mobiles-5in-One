<?php

use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

function requestResetCode(object $test, User $user): string
{
    $test->postJson('/api/v1/auth/forgot', ['email' => $user->email])->assertStatus(202);

    $code = null;
    Mail::assertQueued(PasswordResetCodeMail::class, function (PasswordResetCodeMail $mail) use ($user, &$code): bool {
        $code = $mail->code;

        return $mail->hasTo($user->email);
    });

    return (string) $code;
}

it('answers forgot with the same status and body whether or not the account exists', function (): void {
    $user = User::factory()->create();
    $deactivated = User::factory()->deactivated()->create();

    $known = $this->postJson('/api/v1/auth/forgot', ['email' => $user->email]);
    $unknown = $this->postJson('/api/v1/auth/forgot', ['email' => 'ghost@example.test']);
    $inactive = $this->postJson('/api/v1/auth/forgot', ['email' => $deactivated->email]);

    foreach ([$known, $unknown, $inactive] as $response) {
        $response->assertStatus(202)->assertExactJson(['status' => 'accepted']);
        expect($response->headers->get('Content-Type'))->toBe($known->headers->get('Content-Type'));
    }

    Mail::assertQueuedCount(1);
    Mail::assertQueued(PasswordResetCodeMail::class, fn (PasswordResetCodeMail $mail) => $mail->hasTo($user->email));
});

it('mails a reset code to provider-only accounts so they can add a password', function (): void {
    $user = User::factory()->googleOnly()->create();

    $code = requestResetCode($this, $user);

    expect($code)->toMatch('/^[0-9]{6}$/');
});

it('resets the password, revokes every token and accepts the new password', function (): void {
    $user = User::factory()->unverified()->create();
    $phone = AuthTestKit::token($user, 'phone');
    AuthTestKit::token($user, 'tablet');
    $code = requestResetCode($this, $user);
    $newPassword = AuthTestKit::password();

    $this->postJson('/api/v1/auth/reset', ['email' => $user->email, 'code' => $code, 'password' => $newPassword])
        ->assertNoContent();

    $fresh = $user->fresh();
    expect($fresh?->tokens()->count())->toBe(0)
        ->and(Hash::check($newPassword, (string) $fresh?->password))->toBeTrue()
        ->and($fresh?->password)->toStartWith('$argon2id$')
        ->and($fresh?->hasVerifiedEmail())->toBeTrue();

    $this->withToken($phone)->getJson('/api/v1/me')->assertUnauthorized();

    AuthTestKit::resetLimits();
    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'x', 'platform' => 'ios'])
        ->assertUnauthorized();
    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => $newPassword, 'device_name' => 'x', 'platform' => 'ios'])
        ->assertOk();
});

it('accepts a reset code only once', function (): void {
    $user = User::factory()->create();
    $code = requestResetCode($this, $user);

    $this->postJson('/api/v1/auth/reset', ['email' => $user->email, 'code' => $code, 'password' => AuthTestKit::password()])
        ->assertNoContent();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/reset', ['email' => $user->email, 'code' => $code, 'password' => AuthTestKit::password()]),
        422,
        'auth.token_invalid',
    );
});

it('answers a wrong code and an unknown email identically and changes nothing', function (): void {
    $user = User::factory()->create();
    $token = AuthTestKit::token($user);
    $code = requestResetCode($this, $user);
    $wrong = str_pad((string) (((int) $code + 7) % 1_000_000), 6, '0', STR_PAD_LEFT);

    $a = $this->postJson('/api/v1/auth/reset', ['email' => $user->email, 'code' => $wrong, 'password' => AuthTestKit::password()]);
    $b = $this->postJson('/api/v1/auth/reset', ['email' => 'ghost@example.test', 'code' => $code, 'password' => AuthTestKit::password()]);

    AuthTestKit::assertProblem($a, 422, 'auth.token_invalid');
    AuthTestKit::assertProblem($b, 422, 'auth.token_invalid');
    expect(array_diff_key($a->json(), ['request_id' => 1]))->toBe(array_diff_key($b->json(), ['request_id' => 1]))
        ->and(Hash::check(UserFactory::PASSWORD, (string) $user->fresh()?->password))->toBeTrue();

    $this->withToken($token)->getJson('/api/v1/me')->assertOk();
});

it('rejects each invalid reset field with only its name and rule code', function (array $payload, string $field, string $code): void {
    $base = ['email' => 'a@example.test', 'code' => '123456', 'password' => AuthTestKit::password()];

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/reset', array_filter(array_merge($base, $payload), fn ($v) => $v !== null)),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );
})->with([
    'email missing' => [['email' => null], 'email', 'required'],
    'code malformed' => [['code' => 'abcdef'], 'code', 'regex'],
    'password missing' => [['password' => null], 'password', 'required'],
    'password too short' => [['password' => 'tiny-pw'], 'password', 'min'],
]);

it('rejects forgot without a valid email', function (array $payload, string $code): void {
    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/forgot', $payload),
        422,
        'validation.failed',
        [['field' => 'email', 'code' => $code]],
    );
})->with([
    'missing' => [[], 'required'],
    'malformed' => [['email' => 'nope'], 'email'],
    'too long' => [['email' => str_repeat('a', 250).'@example.test'], 'max'],
]);
