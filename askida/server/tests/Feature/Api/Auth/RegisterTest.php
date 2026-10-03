<?php

use App\Domain\Auth\Consent\KvkkConsentRecorder;
use App\Mail\EmailVerificationCodeMail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

it('registers a donor and returns a device token with the donor ability', function (): void {
    $payload = AuthTestKit::registerPayload();

    $response = $this->postJson('/api/v1/auth/register', $payload);

    $response->assertCreated()
        ->assertJsonStructure(['token', 'token_type', 'expires_at', 'abilities', 'user' => ['id', 'email', 'name', 'kind', 'email_verified']])
        ->assertJsonPath('token_type', 'Bearer')
        ->assertJsonPath('abilities', ['donor'])
        ->assertJsonPath('user.email', $payload['email'])
        ->assertJsonPath('user.kind', 'donor')
        ->assertJsonPath('user.email_verified', false);

    expect(array_keys($response->json('user')))->toBe(['id', 'email', 'name', 'kind', 'email_verified'])
        ->and($response->getContent())->not->toContain($payload['password']);

    $user = User::query()->where('email', $payload['email'])->firstOrFail();
    expect($user->password)->toStartWith('$argon2id$')
        ->and($user->email_verified_at)->toBeNull();

    $token = $user->tokens()->sole();
    expect($token->name)->toBe(AuthTestKit::DEVICE)
        ->and($token->getAttribute('platform'))->toBe('android')
        ->and($token->abilities)->toBe(['donor'])
        ->and($token->expires_at?->diffInDays(now()->addDays(30)))->toBeLessThan(1);
});

it('gives merchants the merchant ability', function (): void {
    $this->postJson('/api/v1/auth/register', AuthTestKit::registerPayload(['kind' => 'merchant']))
        ->assertCreated()
        ->assertJsonPath('abilities', ['merchant'])
        ->assertJsonPath('user.kind', 'merchant');
});

it('stores the email in lower case', function (): void {
    $this->postJson('/api/v1/auth/register', AuthTestKit::registerPayload(['email' => '  Mixed.Case@Example.TEST ']))
        ->assertCreated()
        ->assertJsonPath('user.email', 'mixed.case@example.test');
});

it('records the KVKK consent with a keyed hash of the IP, never the raw address', function (): void {
    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])
        ->postJson('/api/v1/auth/register', AuthTestKit::registerPayload(['kvkk_text_version' => 'v2026.10-tr']))
        ->assertCreated();

    $consent = DB::table('kvkk_consents')->sole();

    expect($consent->text_version)->toBe('v2026.10-tr')
        ->and($consent->ip_hash)->toBe(KvkkConsentRecorder::hashIp('203.0.113.9'))
        ->and($consent->ip_hash)->toMatch('/^[0-9a-f]{64}$/')
        ->and($consent->ip_hash)->not->toBe(hash('sha256', '203.0.113.9'))
        ->and(json_encode($consent))->not->toContain('203.0.113.9');
});

it('queues the verification mail with a code that is stored only as a hash', function (): void {
    $payload = AuthTestKit::registerPayload();
    $this->postJson('/api/v1/auth/register', $payload)->assertCreated();

    $code = null;
    Mail::assertQueued(EmailVerificationCodeMail::class, function (EmailVerificationCodeMail $mail) use ($payload, &$code): bool {
        $code = $mail->code;

        return $mail->hasTo($payload['email']);
    });

    $row = DB::table('password_reset_tokens')->sole();

    expect($code)->toMatch('/^[0-9]{6}$/')
        ->and($row->purpose)->toBe('email_verification')
        ->and($row->code_hash)->toMatch('/^[0-9a-f]{64}$/')
        ->and($row->code_hash)->not->toContain((string) $code);
});

it('rejects each invalid field with only its name and rule code', function (array $overrides, string $field, string $code): void {
    $existing = User::factory()->create(['email' => 'taken@example.test']);
    expect($existing->exists)->toBeTrue();

    $payload = AuthTestKit::registerPayload($overrides);
    foreach ($overrides as $key => $value) {
        if ($value === null) {
            unset($payload[$key]);
        }
    }

    $response = $this->postJson('/api/v1/auth/register', $payload);

    AuthTestKit::assertProblem($response, 422, 'validation.failed', [['field' => $field, 'code' => $code]]);

    foreach ($overrides as $value) {
        if (is_string($value) && strlen($value) > 3) {
            expect($response->getContent())->not->toContain($value);
        }
    }
})->with([
    'email missing' => [['email' => null], 'email', 'required'],
    'email malformed' => [['email' => 'not-an-address'], 'email', 'email'],
    'email too long' => [['email' => str_repeat('a', 250).'@example.test'], 'email', 'max'],
    'email taken' => [['email' => 'taken@example.test'], 'email', 'unique'],
    'password missing' => [['password' => null], 'password', 'required'],
    'password too short' => [['password' => 'short-pw'], 'password', 'min'],
    'password too long' => [['password' => str_repeat('long-pass ', 13)], 'password', 'max'],
    'password not a string' => [['password' => ['x']], 'password', 'string'],
    'name missing' => [['name' => null], 'name', 'required'],
    'name too long' => [['name' => str_repeat('n', 101)], 'name', 'max'],
    'kind missing' => [['kind' => null], 'kind', 'required'],
    'kind unknown' => [['kind' => 'admin'], 'kind', 'enum'],
    'device name missing' => [['device_name' => null], 'device_name', 'required'],
    'device name too long' => [['device_name' => str_repeat('d', 101)], 'device_name', 'max'],
    'platform missing' => [['platform' => null], 'platform', 'required'],
    'platform unknown' => [['platform' => 'windows'], 'platform', 'in'],
    'kvkk version missing' => [['kvkk_text_version' => null], 'kvkk_text_version', 'required'],
    'kvkk version malformed' => [['kvkk_text_version' => 'v 1 <b>'], 'kvkk_text_version', 'regex'],
    'kvkk version too long' => [['kvkk_text_version' => str_repeat('9', 33)], 'kvkk_text_version', 'max'],
]);

it('treats an existing email in another letter case as taken', function (): void {
    User::factory()->create(['email' => 'case@example.test']);

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/register', AuthTestKit::registerPayload(['email' => 'CASE@example.test'])),
        422,
        'validation.failed',
        [['field' => 'email', 'code' => 'unique']],
    );
});

it('creates no user, consent or token when validation fails', function (): void {
    $this->postJson('/api/v1/auth/register', AuthTestKit::registerPayload(['kind' => 'admin']))->assertStatus(422);

    expect(User::query()->count())->toBe(0)
        ->and(DB::table('kvkk_consents')->count())->toBe(0)
        ->and(DB::table('personal_access_tokens')->count())->toBe(0);
    Mail::assertNothingQueued();
});
