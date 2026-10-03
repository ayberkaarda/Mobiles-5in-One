<?php

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Http\Middleware\VerifyCsrfToken;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\Unit\Support\TemporaryEnv;

/*
| Security checklist item 12: session cookie attributes, the strict admin cookie, no
| session on the API and CSRF on the web.
*/

beforeEach(function (): void {
    Route::middleware('web')->post('test-cookies/form', fn () => 'saved');
    Route::middleware('api')->get('api/v1/test-cookies/probe', fn () => ['ok' => true]);
});

function sessionCookie(TestResponse $response, string $name): ?Cookie
{
    foreach ($response->headers->getCookies() as $cookie) {
        if ($cookie->getName() === $name) {
            return $cookie;
        }
    }

    return null;
}

/**
 * @return array<string, mixed>
 */
function productionSessionConfig(): array
{
    return TemporaryEnv::run([
        'APP_ENV' => 'production',
        'SESSION_COOKIE' => 'override-attempt',
        'SESSION_SECURE_COOKIE' => 'false',
        'SESSION_DOMAIN' => 'askida.app',
        'SESSION_PATH' => '/sub',
        'SESSION_SAME_SITE' => 'none',
    ], fn (): array => require config_path('session.php'));
}

it('fixes the production cookie attributes whatever the environment says', function (): void {
    $config = productionSessionConfig();

    expect($config['cookie'])->toBe('__Host-askida_session')
        ->and($config['admin_cookie'])->toBe('__Host-askida_admin_session')
        ->and($config['secure'])->toBeTrue()
        ->and($config['http_only'])->toBeTrue()
        ->and($config['path'])->toBe('/')
        ->and($config['domain'])->toBeNull()
        ->and($config['same_site'])->toBe('lax')
        ->and($config['admin_same_site'])->toBe('strict');
});

it('sends the production session cookie with host-only, secure, http-only and lax attributes', function (): void {
    config(['session' => array_merge(productionSessionConfig(), ['driver' => 'array'])]);

    $response = $this->get('https://localhost/');
    $cookie = sessionCookie($response, '__Host-askida_session');

    expect($cookie)->not->toBeNull()
        ->and($cookie->isSecure())->toBeTrue()
        ->and($cookie->isHttpOnly())->toBeTrue()
        ->and($cookie->getSameSite())->toBe('lax')
        ->and($cookie->getPath())->toBe('/')
        ->and($cookie->getDomain())->toBeNull();
});

it('gives the admin panel its own strict cookie in production', function (): void {
    config(['session' => array_merge(productionSessionConfig(), ['driver' => 'array'])]);

    $response = $this->get('https://localhost/admin/login');
    $response->assertOk();

    $cookie = sessionCookie($response, '__Host-askida_admin_session');

    expect($cookie)->not->toBeNull()
        ->and($cookie->getSameSite())->toBe('strict')
        ->and($cookie->isSecure())->toBeTrue()
        ->and($cookie->isHttpOnly())->toBeTrue()
        ->and(sessionCookie($response, '__Host-askida_session'))->toBeNull();
});

it('uses lax for the public web and strict for the admin in the testing environment', function (): void {
    $public = sessionCookie($this->get('/'), 'askida_session');
    $admin = sessionCookie($this->get('/admin/login'), 'askida_admin_session');

    expect($public?->getSameSite())->toBe('lax')
        ->and($public?->isHttpOnly())->toBeTrue()
        ->and($admin?->getSameSite())->toBe('strict')
        ->and($admin?->isHttpOnly())->toBeTrue();
});

it('keeps the guest login redirect of the panel working with the strict cookie', function (): void {
    $this->get('/admin')->assertRedirect('/admin/login');
});

it('covers the Livewire update endpoint used by the panel with the admin cookie', function (): void {
    $html = (string) $this->get('/admin/login')->getContent();

    preg_match('/data-update-uri="([^"]+)"/', $html, $match);
    $path = ltrim($match[1] ?? '', '/');

    expect($path)->not->toBe('')
        ->and(Request::create('/'.$path)->is('admin', 'admin/*', 'livewire/*'))->toBeTrue();
});

it('does not start a session or set cookies on the API', function (): void {
    $response = $this->getJson('/api/v1/test-cookies/probe');

    $response->assertOk();

    expect($response->headers->getCookies())->toBe([])
        ->and($response->headers->has('Set-Cookie'))->toBeFalse();
});

it('rejects a web form post without a CSRF token', function (): void {
    // The framework skips the check while running tests; switch that shortcut off.
    $this->app->bind(PreventRequestForgery::class, fn ($app) => new class($app, $app['encrypter']) extends PreventRequestForgery
    {
        protected function runningUnitTests()
        {
            return false;
        }
    });

    $this->post('/test-cookies/form')->assertStatus(419);

    $this->withSession(['_token' => 'csrf-test-value'])
        ->post('/test-cookies/form', ['_token' => 'csrf-test-value'])
        ->assertOk();
});

it('keeps CSRF protection in the web group and in the admin panel stack', function (): void {
    $web = app('router')->getMiddlewareGroups()['web'] ?? [];
    $panel = filament()->getPanel('admin')->getMiddleware();

    expect($web)->toContain(PreventRequestForgery::class)
        ->and($panel)->toContain(VerifyCsrfToken::class)
        ->and(app('router')->getMiddlewareGroups()['api'] ?? [])->not->toContain(PreventRequestForgery::class);
});
