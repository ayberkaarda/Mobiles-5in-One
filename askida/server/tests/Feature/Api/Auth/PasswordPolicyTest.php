<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

it('rejects a password listed by the breach service', function (): void {
    AuthTestKit::boot(cleanBreachService: false);
    $payload = AuthTestKit::registerPayload();
    AuthTestKit::fakeBreachService(AuthTestKit::breachedBody($payload['password']));

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/register', $payload),
        422,
        'validation.failed',
        [['field' => 'password', 'code' => 'uncompromised']],
    );

    expect(User::query()->count())->toBe(0);

    // Only the five-character hash prefix leaves the server.
    $prefix = substr(strtoupper(sha1($payload['password'])), 0, 5);
    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://api.pwnedpasswords.com/range/'.$prefix);
});

it('accepts the password and logs a warning when the breach service is unreachable', function (): void {
    AuthTestKit::boot(cleanBreachService: false);
    Http::fake(['api.pwnedpasswords.com/*' => fn () => throw new ConnectionException('unreachable')]);

    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged): void {
        $logged[] = [$event->level, $event->message];
    });

    $this->postJson('/api/v1/auth/register', AuthTestKit::registerPayload())->assertCreated();

    expect($logged)->toContain(['warning', 'Breached password check unavailable; the password was accepted without it.']);
});

it('accepts the password and logs a warning when the breach service answers with an error', function (): void {
    AuthTestKit::boot(cleanBreachService: false);
    Http::fake(['api.pwnedpasswords.com/*' => Http::response('', 503)]);

    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged): void {
        $logged[] = $event->level;
    });

    $this->postJson('/api/v1/auth/register', AuthTestKit::registerPayload())->assertCreated();

    expect($logged)->toContain('warning');
});

it('applies the same policy to password reset', function (): void {
    AuthTestKit::boot(cleanBreachService: false);
    $password = AuthTestKit::password();
    AuthTestKit::fakeBreachService(AuthTestKit::breachedBody($password));

    AuthTestKit::assertProblem(
        $this->postJson('/api/v1/auth/reset', ['email' => 'a@example.test', 'code' => '123456', 'password' => $password]),
        422,
        'validation.failed',
        [['field' => 'password', 'code' => 'uncompromised']],
    );
});
