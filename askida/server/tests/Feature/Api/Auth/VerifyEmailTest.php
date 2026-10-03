<?php

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Enums\OneTimeCodePurpose;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

function issueVerificationCode(User $user): string
{
    return app(OneTimeCodeService::class)->issue($user, OneTimeCodePurpose::EmailVerification);
}

function wrongCode(string $code): string
{
    return str_pad((string) (((int) $code + 1) % 1_000_000), 6, '0', STR_PAD_LEFT);
}

it('verifies the email with the mailed code, without a token', function (): void {
    $user = User::factory()->unverified()->create();
    $code = issueVerificationCode($user);

    $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $code])
        ->assertOk()
        ->assertExactJson(['email_verified' => true]);

    expect($user->fresh()?->hasVerifiedEmail())->toBeTrue()
        ->and(DB::table('password_reset_tokens')->count())->toBe(0);
});

it('accepts a code only once', function (): void {
    $user = User::factory()->unverified()->create();
    $code = issueVerificationCode($user);

    $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $code])->assertOk();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $code]),
        422,
        'auth.token_invalid',
    );
});

it('rejects an expired code after 60 minutes', function (): void {
    $user = User::factory()->unverified()->create();
    $code = issueVerificationCode($user);

    $this->travel(61)->minutes();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $code]),
        422,
        'auth.token_invalid',
    );
    expect($user->fresh()?->hasVerifiedEmail())->toBeFalse();
});

it('discards the code after five wrong guesses', function (): void {
    $user = User::factory()->unverified()->create();
    $code = issueVerificationCode($user);

    foreach (range(1, 5) as $attempt) {
        AuthTestKit::assertProblem(
            $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => wrongCode($code)]),
            422,
            'auth.token_invalid',
        );
    }

    AuthTestKit::resetLimits();

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $code]),
        422,
        'auth.token_invalid',
    );
    expect($user->fresh()?->hasVerifiedEmail())->toBeFalse();
});

it('answers an unknown email exactly like a wrong code', function (): void {
    $user = User::factory()->unverified()->create();
    $code = issueVerificationCode($user);

    $unknown = $this->postJson('/api/v1/auth/verify-email', ['email' => 'ghost@example.test', 'code' => $code]);
    $wrong = $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => wrongCode($code)]);

    expect($unknown->status())->toBe($wrong->status())
        ->and(array_diff_key($unknown->json(), ['request_id' => 1]))->toBe(array_diff_key($wrong->json(), ['request_id' => 1]));
});

it('stores the code only as a keyed hash', function (): void {
    $user = User::factory()->unverified()->create();
    $code = issueVerificationCode($user);

    $row = DB::table('password_reset_tokens')->sole();

    expect($row->code_hash)->not->toBe($code)
        ->and($row->code_hash)->not->toBe(hash('sha256', $code))
        ->and($row->code_hash)->toMatch('/^[0-9a-f]{64}$/');
});

it('replaces an older code when a new one is issued', function (): void {
    $user = User::factory()->unverified()->create();
    $old = issueVerificationCode($user);
    $new = issueVerificationCode($user);

    if ($old !== $new) {
        AuthTestKit::assertProblem(
            $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $old]),
            422,
            'auth.token_invalid',
        );
    }

    $this->postJson('/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $new])->assertOk();
});

it('rejects each invalid field with only its name and rule code', function (array $payload, string $field, string $code): void {
    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/verify-email', $payload),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );
})->with([
    'email missing' => [['code' => '123456'], 'email', 'required'],
    'email malformed' => [['email' => 'x', 'code' => '123456'], 'email', 'email'],
    'code missing' => [['email' => 'a@example.test'], 'code', 'required'],
    'code too short' => [['email' => 'a@example.test', 'code' => '12345'], 'code', 'regex'],
    'code with letters' => [['email' => 'a@example.test', 'code' => '12a456'], 'code', 'regex'],
]);
