<?php

use App\Domain\Accounts\Services\PushTokenRegistry;
use App\Domain\Auth\Models\DevicePushToken;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

/**
 * A registration-token-shaped value assembled at run time.
 */
function pushRegistration(): string
{
    return 'reg-'.bin2hex(random_bytes(20)).':'.bin2hex(random_bytes(12));
}

it('registers a push token and answers with an empty body', function (): void {
    $user = User::factory()->create();
    $value = pushRegistration();

    $response = $this->withToken(AuthTestKit::token($user))
        ->putJson('/api/v1/me/push-token', ['platform' => 'ios', 'token' => $value]);

    $response->assertNoContent();
    expect($response->getContent())->toBe('');

    $row = DevicePushToken::query()->sole();
    expect($row->user_id)->toBe($user->id)
        ->and($row->token)->toBe($value)
        ->and($row->platform->value)->toBe('ios')
        ->and($row->last_used_at)->not->toBeNull();
});

it('keeps one row per token and refreshes it on a repeated registration', function (): void {
    $user = User::factory()->create();
    $value = pushRegistration();
    $token = AuthTestKit::token($user);

    $this->withToken($token)->putJson('/api/v1/me/push-token', ['platform' => 'ios', 'token' => $value])->assertNoContent();
    $this->withToken($token)->putJson('/api/v1/me/push-token', ['platform' => 'android', 'token' => $value])->assertNoContent();

    expect(DevicePushToken::query()->count())->toBe(1)
        ->and(DevicePushToken::query()->sole()->platform->value)->toBe('android');
});

it('moves a token to the account that registered it last', function (): void {
    $first = User::factory()->create();
    $second = User::factory()->create();
    $value = pushRegistration();

    $this->withToken(AuthTestKit::token($first))->putJson('/api/v1/me/push-token', ['platform' => 'ios', 'token' => $value])->assertNoContent();
    AuthTestKit::forgetGuards();
    $this->withToken(AuthTestKit::token($second))->putJson('/api/v1/me/push-token', ['platform' => 'ios', 'token' => $value])->assertNoContent();

    expect(DevicePushToken::query()->sole()->user_id)->toBe($second->id);
});

it('keeps at most ten tokens per account and drops the oldest', function (): void {
    $user = User::factory()->create();
    $token = AuthTestKit::token($user);
    $values = [];

    for ($i = 0; $i < PushTokenRegistry::MAX_PER_USER + 2; $i++) {
        Carbon::setTestNow(Carbon::now()->addSecond());
        $values[$i] = pushRegistration();
        $this->withToken($token)->putJson('/api/v1/me/push-token', ['platform' => 'android', 'token' => $values[$i]])->assertNoContent();
    }

    Carbon::setTestNow();

    $stored = DevicePushToken::query()->where('user_id', $user->id)->pluck('token')->all();

    expect($stored)->toHaveCount(PushTokenRegistry::MAX_PER_USER)
        ->not->toContain($values[0])
        ->not->toContain($values[1])
        ->toContain($values[PushTokenRegistry::MAX_PER_USER + 1]);
});

it('validates the platform and the token length', function (array $payload, string $field, string $code): void {
    $user = User::factory()->create();

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($user))->putJson('/api/v1/me/push-token', $payload),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );

    expect(DevicePushToken::query()->count())->toBe(0);
})->with([
    'missing token' => [['platform' => 'ios'], 'token', 'required'],
    'token too long' => [['platform' => 'ios', 'token' => str_repeat('a', 4097)], 'token', 'max'],
    'token with spaces' => [['platform' => 'ios', 'token' => 'two words'], 'token', 'regex'],
    'unknown platform' => [['platform' => 'web', 'token' => 'device-registration'], 'platform', 'enum'],
]);

it('accepts a token of exactly 4096 characters', function (): void {
    $user = User::factory()->create();

    $this->withToken(AuthTestKit::token($user))
        ->putJson('/api/v1/me/push-token', ['platform' => 'android', 'token' => str_repeat('b', 4096)])
        ->assertNoContent();
});

it('requires a user token', function (): void {
    AuthTestKit::assertProblem(
        $this->putJson('/api/v1/me/push-token', ['platform' => 'ios', 'token' => pushRegistration()]),
        401,
        'auth.unauthenticated',
    );
});

it('never writes the token value to the log', function (): void {
    $logPath = storage_path('logs/test-push-'.bin2hex(random_bytes(4)).'.log');
    config([
        'logging.default' => 'stack',
        'logging.channels.stack.channels' => ['single'],
        'logging.channels.single.path' => $logPath,
        'logging.channels.single.level' => 'debug',
    ]);
    app('log')->forgetChannel('stack');
    app('log')->forgetChannel('single');

    try {
        $user = User::factory()->create();
        $value = pushRegistration();

        $this->withToken(AuthTestKit::token($user))
            ->putJson('/api/v1/me/push-token', ['platform' => 'ios', 'token' => $value])
            ->assertNoContent();

        // A careless context array is masked by key as well.
        Log::info('push registration stored', ['token' => $value, 'push' => ['token' => $value]]);

        $log = File::get($logPath);

        expect($log)->toContain('push registration stored')
            ->toContain('"route":"api/v1/me/push-token"')
            ->not->toContain($value)
            ->not->toContain(substr($value, 4, 20));
    } finally {
        File::delete($logPath);
    }
});
