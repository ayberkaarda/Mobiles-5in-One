<?php

use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

function badLogin(object $test, string $email, string $ip = '198.51.100.10', array $headers = []): TestResponse
{
    return $test->withServerVariables(['REMOTE_ADDR' => $ip])
        ->withHeaders($headers)
        ->postJson('/api/v1/auth/login', [
            'email' => $email,
            'password' => 'wrong-'.bin2hex(random_bytes(4)),
            'device_name' => 'rate-test',
            'platform' => 'android',
        ]);
}

it('applies the auth limiter to every public auth endpoint, 5 per minute per IP', function (string $uri): void {
    foreach (range(1, 5) as $i) {
        $status = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->postJson($uri, [])->status();
        expect($status)->not->toBe(429);
    }

    $response = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->postJson($uri, []);

    AuthTestKit::assertProblem($response, 429, 'rate_limited');
    expect((int) $response->headers->get('Retry-After'))->toBeGreaterThan(0)->toBeLessThanOrEqual(60);
})->with([
    'register' => '/api/v1/auth/register',
    'login' => '/api/v1/auth/login',
    'apple' => '/api/v1/auth/apple',
    'google' => '/api/v1/auth/google',
    'forgot' => '/api/v1/auth/forgot',
    'reset' => '/api/v1/auth/reset',
    'verify-email' => '/api/v1/auth/verify-email',
]);

it('limits per email across different IPs', function (): void {
    foreach (range(1, 5) as $i) {
        badLogin($this, 'target@example.test', '198.51.100.'.(30 + $i))->assertUnauthorized();
    }

    AuthTestKit::assertProblem(badLogin($this, 'target@example.test', '198.51.100.99'), 429, 'rate_limited');
});

it('ignores a spoofed X-Forwarded-For header from an untrusted sender', function (): void {
    foreach (range(1, 5) as $i) {
        badLogin($this, "spoof{$i}@example.test", '198.51.100.40', ['X-Forwarded-For' => "203.0.113.{$i}"])
            ->assertUnauthorized();
    }

    $response = badLogin($this, 'spoof6@example.test', '198.51.100.40', ['X-Forwarded-For' => '203.0.113.200']);

    AuthTestKit::assertProblem($response, 429, 'rate_limited');
});

it('opens again after the minute has passed', function (): void {
    foreach (range(1, 5) as $i) {
        badLogin($this, "later{$i}@example.test");
    }
    badLogin($this, 'later6@example.test')->assertStatus(429);

    $this->travel(61)->seconds();

    badLogin($this, 'later7@example.test')->assertUnauthorized();
});

it('locks an email and IP pair for 15 minutes after 10 failed logins, then lets it in', function (): void {
    $user = User::factory()->create();

    foreach (range(1, 10) as $i) {
        badLogin($this, $user->email)->assertUnauthorized();

        if ($i === 5) {
            $this->travel(61)->seconds();
        }
    }

    $this->travel(61)->seconds();

    $locked = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.10'])->postJson('/api/v1/auth/login', [
        'email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'd', 'platform' => 'ios',
    ]);

    AuthTestKit::assertProblem($locked, 429, 'auth.locked');
    expect((int) $locked->headers->get('Retry-After'))->toBeGreaterThan(800)->toBeLessThanOrEqual(900);

    // Another IP is a different pair and is not locked.
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.11'])->postJson('/api/v1/auth/login', [
        'email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'd', 'platform' => 'ios',
    ])->assertOk();

    $this->travel(15)->minutes();

    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.10'])->postJson('/api/v1/auth/login', [
        'email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'd', 'platform' => 'ios',
    ])->assertOk();
});

it('clears the failure counter on a successful login', function (): void {
    $user = User::factory()->create();
    $goodLogin = fn () => $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.10'])->postJson('/api/v1/auth/login', [
        'email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'd', 'platform' => 'ios',
    ]);

    // Spacing the attempts keeps them under the per-minute limiter but inside the
    // 15-minute lockout window.
    foreach (range(1, 9) as $i) {
        badLogin($this, $user->email)->assertUnauthorized();
        $this->travel(61)->seconds();
    }

    $goodLogin()->assertOk();
    $this->travel(61)->seconds();

    foreach (range(1, 9) as $i) {
        badLogin($this, $user->email)->assertUnauthorized();
        $this->travel(61)->seconds();
    }

    $goodLogin()->assertOk();
});

it('reads the lockout thresholds from configuration', function (): void {
    expect(config('auth.lockout.attempts'))->toBe(10)
        ->and(config('auth.lockout.minutes'))->toBe(15);
});
