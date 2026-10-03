<?php

use Illuminate\Support\Facades\Route;
use Tests\Unit\Support\TemporaryEnv;

/*
| Security checklist item 8: the API is shared only with the configured origin.
*/

beforeEach(function (): void {
    Route::middleware('api')->get('api/v1/test-cors/probe', fn () => ['ok' => true]);
    Route::middleware('web')->get('test-cors/page', fn () => 'ok');
});

it('allows the configured origin on the API', function (): void {
    $response = $this->getJson('/api/v1/test-cors/probe', ['Origin' => 'https://askida.app']);

    $response->assertOk()
        ->assertHeader('Access-Control-Allow-Origin', 'https://askida.app')
        ->assertHeaderMissing('Access-Control-Allow-Credentials');

    expect((string) $response->headers->get('Access-Control-Expose-Headers'))->toContain('X-Request-Id');
});

it('gives any other origin no Access-Control-Allow-Origin', function (string $origin): void {
    $this->getJson('/api/v1/test-cors/probe', ['Origin' => $origin])
        ->assertOk()
        ->assertHeaderMissing('Access-Control-Allow-Origin')
        ->assertHeader('Vary');
})->with([
    'foreign site' => ['https://evil.example'],
    'lookalike suffix' => ['https://askida.app.evil.example'],
    'lookalike prefix' => ['https://notaskida.app'],
    'plain http' => ['http://askida.app'],
    'null origin' => ['null'],
]);

it('answers a preflight from the allowed origin with the explicit lists', function (): void {
    $response = $this->call('OPTIONS', '/api/v1/test-cors/probe', server: [
        'HTTP_ORIGIN' => 'https://askida.app',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization, content-type',
    ]);

    $response->assertNoContent()
        ->assertHeader('Access-Control-Allow-Origin', 'https://askida.app')
        ->assertHeader('Access-Control-Max-Age', '600')
        ->assertHeaderMissing('Access-Control-Allow-Credentials');

    expect((string) $response->headers->get('Access-Control-Allow-Methods'))->toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS')
        ->and((string) $response->headers->get('Access-Control-Allow-Headers'))->toBe('accept, accept-language, authorization, content-type, x-request-id')
        ->and((string) $response->headers->get('Access-Control-Allow-Methods'))->not->toContain('*')
        ->and((string) $response->headers->get('Access-Control-Allow-Headers'))->not->toContain('*');
});

it('answers a preflight from another origin without allow headers', function (): void {
    $response = $this->call('OPTIONS', '/api/v1/test-cors/probe', server: [
        'HTTP_ORIGIN' => 'https://evil.example',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'DELETE',
    ]);

    $response->assertHeaderMissing('Access-Control-Allow-Origin');
});

it('does not apply CORS outside the API', function (): void {
    $this->get('/test-cors/page', ['Origin' => 'https://askida.app'])
        ->assertHeaderMissing('Access-Control-Allow-Origin');
});

it('never configures a wildcard or credentials', function (): void {
    expect(config('cors.allowed_origins'))->toBe(['https://askida.app'])
        ->and(config('cors.paths'))->toBe(['api/*'])
        ->and(config('cors.supports_credentials'))->toBeFalse()
        ->and(config('cors.allowed_origins_patterns'))->toBe(['#\A'.preg_quote('https://askida.app', '#').'\z#'])
        ->and(config('cors.allowed_methods'))->not->toContain('*')
        ->and(config('cors.allowed_headers'))->not->toContain('*');

    $config = TemporaryEnv::run(
        ['SECURITY_CORS_ALLOWED_ORIGINS' => '*, https://askida.app ,https://*.askida.app,'],
        fn (): array => require config_path('cors.php'),
    );

    expect($config['allowed_origins'])->toBe(['https://askida.app']);
});
