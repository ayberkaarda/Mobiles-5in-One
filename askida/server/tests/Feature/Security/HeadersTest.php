<?php

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\Unit\Support\TemporaryEnv;

/*
| Security checklist item 9: header assertions per route class.
*/

beforeEach(function (): void {
    Route::middleware('api')->get('api/v1/test-headers/probe', fn () => ['ok' => true]);
    Route::middleware('web')->get('test-headers/inline', fn () => Blade::render('<script @nonce>window.ok = 1</script>'));
    Route::middleware('web')->get('pay/test-headers', fn () => Blade::render('<p>odeme</p>'));
});

/**
 * @return array<string, string>
 */
function cspDirectives(TestResponse $response): array
{
    $directives = [];

    foreach (explode(';', (string) $response->headers->get('Content-Security-Policy')) as $part) {
        $part = trim($part);

        if ($part === '') {
            continue;
        }

        [$name, $value] = array_pad(explode(' ', $part, 2), 2, '');
        $directives[$name] = $value;
    }

    return $directives;
}

function assertCommonHeaders(TestResponse $response): void
{
    $response->assertHeader('X-Content-Type-Options', 'nosniff')
        ->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
        ->assertHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')
        ->assertHeader('X-Frame-Options', 'deny')
        ->assertHeaderMissing('X-Powered-By')
        ->assertHeaderMissing('Server');

    $csp = cspDirectives($response);

    expect($csp['frame-ancestors'] ?? null)->toBe("'none'")
        ->and($csp['object-src'] ?? null)->toBe("'none'");
}

it('sends the strict policy with a nonce on public web pages', function (): void {
    $response = $this->get('/');

    $response->assertOk();
    assertCommonHeaders($response);

    $csp = cspDirectives($response);

    expect($csp['default-src'])->toBe("'self'")
        ->and($csp['script-src'])->toMatch("/^'self' 'nonce-[A-Za-z0-9+\\/]{24}'$/")
        ->and($csp['style-src'])->toMatch("/^'self' 'nonce-[A-Za-z0-9+\\/]{24}'$/")
        ->and($csp['base-uri'])->toBe("'self'")
        ->and($csp['form-action'])->toBe("'self'")
        ->and((string) $response->headers->get('Content-Security-Policy'))->not->toContain('unsafe-');
});

it('exposes the request nonce to Blade and renews it per request', function (): void {
    $first = $this->get('/test-headers/inline');
    $second = $this->get('/test-headers/inline');

    preg_match("/'nonce-([^']+)'/", cspDirectives($first)['script-src'], $match);
    $nonce = $match[1] ?? '';

    expect($nonce)->not->toBe('')
        ->and((string) $first->getContent())->toContain('<script nonce="'.$nonce.'">')
        ->and(cspDirectives($second)['script-src'])->not->toContain($nonce);
});

it('sends HSTS only on HTTPS requests unless forced', function (): void {
    $this->get('http://localhost/')->assertHeaderMissing('Strict-Transport-Security');

    $this->get('https://localhost/')
        ->assertHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

    config(['secure-headers.hsts_force' => true]);

    $this->get('http://localhost/')
        ->assertHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
});

it('relaxes the policy on the admin panel only as far as the real login page needs', function (): void {
    $response = $this->get('/admin/login');

    $response->assertOk();
    assertCommonHeaders($response);

    $csp = cspDirectives($response);

    expect($csp['script-src'])->toBe("'self' 'unsafe-inline' 'unsafe-eval'")
        ->and($csp['style-src'])->toBe("'self' 'unsafe-inline'")
        ->and($csp['font-src'])->toBe("'self' data:")
        ->and($csp['img-src'])->toBe("'self' data:")
        ->and($csp['default-src'])->toBe("'self'")
        ->and($csp['connect-src'])->toBe("'self'")
        ->and($csp)->not->toHaveKey('frame-src');

    // Every external asset the rendered panel references must be allowed, and nothing more.
    preg_match_all('/(?:src|href)="(https?:\/\/[^"\/]+)/', (string) $response->getContent(), $matches);
    $hosts = array_values(array_unique(array_filter(
        $matches[1],
        static fn (string $origin): bool => ! str_contains($origin, 'localhost'),
    )));

    // No third-party host: not in the header and not referenced by the page.
    expect($hosts)->toBe([])
        ->and((string) $response->headers->get('Content-Security-Policy'))->not->toContain('https://');
});

it('opens frame-src on payment pages to the configured hosts only', function (): void {
    $response = $this->get('/pay/test-headers');
    assertCommonHeaders($response);

    expect(cspDirectives($response)['frame-src'])->toBe("'none'");

    $hosts = 'https://sandbox-frame.payments.test, https://frame.payments.test';
    $profiles = config('secure-headers.csp_profiles');
    $profiles['pay']['frame-src'] = ['allow' => array_map('trim', explode(',', $hosts))];
    config(['secure-headers.csp_profiles' => $profiles]);

    $csp = cspDirectives($this->get('/pay/test-headers'));

    expect($csp['frame-src'])->toBe('https://sandbox-frame.payments.test https://frame.payments.test')
        ->and($csp['script-src'])->toMatch("/^'self' 'nonce-/");
});

it('reads the payment frame hosts from the environment list', function (): void {
    $config = TemporaryEnv::run(
        ['SECURITY_CSP_FRAME_SRC_PAY' => 'https://a.payments.test, ,https://b.payments.test'],
        fn (): array => require config_path('secure-headers.php'),
    );

    expect($config['csp_profiles']['pay']['frame-src'])
        ->toBe(['allow' => ['https://a.payments.test', 'https://b.payments.test']]);
});

it('opens script-src and connect-src on payment pages to the configured hosts and changes no other profile', function (): void {
    $emptyConfig = TemporaryEnv::run(
        ['SECURITY_CSP_SCRIPT_SRC_PAY' => '', 'SECURITY_CSP_CONNECT_SRC_PAY' => '', 'SECURITY_CSP_FRAME_SRC_PAY' => ''],
        fn (): array => require config_path('secure-headers.php'),
    );
    $configured = TemporaryEnv::run(
        [
            'SECURITY_CSP_SCRIPT_SRC_PAY' => 'https://scripts.payments.test, ,https://more.payments.test',
            'SECURITY_CSP_CONNECT_SRC_PAY' => 'https://api.payments.test',
            'SECURITY_CSP_FRAME_SRC_PAY' => '',
        ],
        fn (): array => require config_path('secure-headers.php'),
    );

    expect(array_keys($emptyConfig['csp_profiles']['pay']))->toBe(['frame-src'])
        ->and($configured['csp_profiles']['pay']['script-src'])
        ->toBe(['self' => true, 'use-nonce' => true, 'allow' => ['https://scripts.payments.test', 'https://more.payments.test']])
        ->and($configured['csp_profiles']['pay']['connect-src'])->toBe(['self' => true, 'allow' => ['https://api.payments.test']])
        ->and($configured['csp_profiles']['pay']['frame-src'])->toBe(['none' => true])
        ->and(array_diff_key($configured['csp_profiles'], ['pay' => 1]))->toBe(array_diff_key($emptyConfig['csp_profiles'], ['pay' => 1]))
        ->and($configured['csp'])->toBe($emptyConfig['csp']);

    $before = [
        'pay' => cspDirectives($this->get('/pay/test-headers')),
        'web' => cspDirectives($this->get('/test-headers/inline')),
        'api' => cspDirectives($this->getJson('/api/v1/test-headers/probe')),
    ];
    config(['secure-headers.csp_profiles' => $configured['csp_profiles']]);
    $after = [
        'pay' => cspDirectives($this->get('/pay/test-headers')),
        'web' => cspDirectives($this->get('/test-headers/inline')),
        'api' => cspDirectives($this->getJson('/api/v1/test-headers/probe')),
    ];

    expect($before['pay']['script-src'])->toMatch("/^'self' 'nonce-[^ ']+'$/")
        ->and($after['pay']['script-src'])->toMatch("/^'self' 'nonce-[^ ']+' https:\/\/scripts\.payments\.test https:\/\/more\.payments\.test$/")
        ->and($after['pay']['connect-src'])->toContain('https://api.payments.test')
        ->and($before['pay']['connect-src'])->toBe("'self'")
        ->and($after['pay']['frame-src'])->toBe("'none'")
        ->and(preg_replace("/'nonce-[^']+'/", "'nonce'", implode(';', $after['web'])))->toBe(preg_replace("/'nonce-[^']+'/", "'nonce'", implode(';', $before['web'])))
        ->and($after['api'])->toBe($before['api'])
        ->and($after['web']['script-src'])->not->toContain('payments.test')
        ->and($after['web']['connect-src'])->toBe("'self'");
});

it('locks API responses down and disables caching', function (): void {
    $response = $this->getJson('/api/v1/test-headers/probe');

    $response->assertOk();
    assertCommonHeaders($response);

    expect((string) $response->headers->get('Cache-Control'))->toContain('no-store')
        ->and(cspDirectives($response)['default-src'])->toBe("'none'");
});

it('adds the headers to error responses too', function (string $path, bool $api): void {
    $response = $api ? $this->getJson($path) : $this->get($path);

    $response->assertNotFound();
    assertCommonHeaders($response);

    if ($api) {
        expect((string) $response->headers->get('Cache-Control'))->toContain('no-store');
    }
})->with([
    'web 404' => ['/sayfa-yok', false],
    'api 404' => ['/api/v1/yok', true],
]);
