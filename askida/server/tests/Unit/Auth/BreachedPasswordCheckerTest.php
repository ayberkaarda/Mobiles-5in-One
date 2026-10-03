<?php

use App\Domain\Auth\Passwords\BreachedPasswordChecker;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

beforeEach(fn () => Http::preventStrayRequests());

it('reports a password present in the range response as breached', function (): void {
    $password = AuthTestKit::password();
    Http::fake(['api.pwnedpasswords.com/*' => Http::response(AuthTestKit::breachedBody($password))]);

    expect(app(BreachedPasswordChecker::class)->isBreached($password))->toBeTrue();
});

it('reports a password missing from the range response as clean', function (): void {
    Http::fake(['api.pwnedpasswords.com/*' => Http::response(AuthTestKit::breachedBody('other '.AuthTestKit::password()))]);

    expect(app(BreachedPasswordChecker::class)->isBreached(AuthTestKit::password()))->toBeFalse();
});

it('ignores padding entries with a zero count', function (): void {
    $password = AuthTestKit::password();
    $suffix = substr(strtoupper(sha1($password)), 5);
    Http::fake(['api.pwnedpasswords.com/*' => Http::response($suffix.':0')]);

    expect(app(BreachedPasswordChecker::class)->isBreached($password))->toBeFalse();
});

it('sends only the five-character prefix of the hash', function (): void {
    $password = AuthTestKit::password();
    $hash = strtoupper(sha1($password));
    Http::fake(['api.pwnedpasswords.com/*' => Http::response('')]);

    app(BreachedPasswordChecker::class)->isBreached($password);

    Http::assertSent(fn (Request $request): bool => $request->url() === 'https://api.pwnedpasswords.com/range/'.substr($hash, 0, 5)
        && ! str_contains($request->url(), substr($hash, 5))
        && ! str_contains($request->url(), $password));
});

it('fails open with a warning when the service is unreachable', function (): void {
    Http::fake(['api.pwnedpasswords.com/*' => fn () => throw new ConnectionException('unreachable')]);
    Log::spy();

    expect(app(BreachedPasswordChecker::class)->isBreached(AuthTestKit::password()))->toBeFalse();

    Log::shouldHaveReceived('warning')->once()->with('Breached password check unavailable; the password was accepted without it.');
});

it('skips the lookup when disabled', function (): void {
    config(['services.breached_passwords.enabled' => false]);
    Http::fake();

    expect(app(BreachedPasswordChecker::class)->isBreached(AuthTestKit::password()))->toBeFalse();
    Http::assertNothingSent();
});
