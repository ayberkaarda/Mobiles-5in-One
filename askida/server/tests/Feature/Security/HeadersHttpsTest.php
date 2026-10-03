<?php

use App\Providers\SecurityServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\Unit\Support\TemporaryEnv;

/*
| Security checklist item 10: HTTPS only outside local and tests; forwarded headers are
| honoured only from trusted proxies.
*/

beforeEach(function (): void {
    Route::middleware('api')->get('api/v1/test-https/whoami', fn (Request $request) => [
        'ip' => $request->ip(),
        'secure' => $request->isSecure(),
    ]);
    Route::middleware('web')->get('test-https/page', fn () => 'ok');
    Route::middleware('web')->post('test-https/form', fn () => 'ok');
});

function asProduction(): void
{
    app()->detectEnvironment(fn (): string => 'production');
}

it('serves plain HTTP in the testing environment', function (): void {
    $this->get('http://localhost/test-https/page')->assertOk();
});

it('redirects plain HTTP web reads to the configured HTTPS host in production', function (): void {
    asProduction();
    config(['app.url' => 'https://askida.app']);

    $this->get('http://localhost/test-https/page?x=1')
        ->assertStatus(301)
        ->assertHeader('Location', 'https://askida.app/test-https/page?x=1');

    // A forged Host header does not choose the redirect target.
    $this->get('http://evil.example/test-https/page')
        ->assertStatus(301)
        ->assertHeader('Location', 'https://askida.app/test-https/page');
});

it('refuses plain HTTP web writes in production', function (): void {
    asProduction();

    $this->post('http://localhost/test-https/form')->assertForbidden();
});

it('rejects plain HTTP API calls with a problem body in production', function (): void {
    asProduction();

    $this->getJson('http://localhost/api/v1/test-https/whoami')
        ->assertForbidden()
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'https_required');
});

it('serves HTTPS requests in production', function (): void {
    asProduction();

    $this->getJson('https://localhost/api/v1/test-https/whoami')->assertOk()->assertJsonPath('secure', true);
    $this->get('https://localhost/test-https/page')->assertOk();
});

it('keeps the health route reachable over plain HTTP for the container check', function (): void {
    asProduction();

    $this->get('http://localhost/up')->assertOk();
});

it('ignores a spoofed X-Forwarded-Proto from an untrusted peer in production', function (): void {
    asProduction();

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
        ->getJson('http://localhost/api/v1/test-https/whoami', ['X-Forwarded-Proto' => 'https'])
        ->assertForbidden()
        ->assertJsonPath('code', 'https_required');
});

it('honours X-Forwarded-Proto from a configured trusted proxy', function (): void {
    asProduction();
    config(['trustedproxy.proxies' => ['10.0.0.0/8']]);

    $this->withServerVariables(['REMOTE_ADDR' => '10.1.2.3'])
        ->getJson('http://localhost/api/v1/test-https/whoami', ['X-Forwarded-Proto' => 'https'])
        ->assertOk()
        ->assertJsonPath('secure', true);
});

it('ignores a spoofed X-Forwarded-For unless the peer is trusted', function (): void {
    $spoofed = ['X-Forwarded-For' => '198.51.100.23'];

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
        ->getJson('/api/v1/test-https/whoami', $spoofed)
        ->assertJsonPath('ip', '203.0.113.7');

    // A managed-hosting Host suffix must not switch trust on.
    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
        ->getJson('http://app.on-forge.com/api/v1/test-https/whoami', $spoofed)
        ->assertJsonPath('ip', '203.0.113.7');

    config(['trustedproxy.proxies' => ['203.0.113.7']]);

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])
        ->getJson('/api/v1/test-https/whoami', $spoofed)
        ->assertJsonPath('ip', '198.51.100.23');
});

it('parses TRUSTED_PROXIES: empty means none, star only when explicit', function (?string $value, array|string $expected): void {
    $config = TemporaryEnv::run(['TRUSTED_PROXIES' => $value], fn (): array => require config_path('trustedproxy.php'));

    expect($config['proxies'])->toBe($expected);
})->with([
    'unset' => [null, []],
    'empty' => ['', []],
    'list' => ['10.0.0.1, 192.168.0.0/16,', ['10.0.0.1', '192.168.0.0/16']],
    'explicit star' => ['*', '*'],
    'star inside a list is dropped' => ['10.0.0.1,*', ['10.0.0.1']],
]);

it('forces https URLs outside local and testing', function (): void {
    expect(url('/x'))->toStartWith('http://');

    asProduction();
    (new SecurityServiceProvider(app()))->boot();

    expect(url('/x'))->toStartWith('https://');
});
