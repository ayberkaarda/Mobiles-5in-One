<?php

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpKernel\Exception\UnsupportedMediaTypeHttpException;

/*
| Security checklist item 13: errors never leak internals. The routes below exist only
| inside these tests.
*/

beforeEach(function (): void {
    $this->leak = 'SQLSTATE[42P01] select * from users where email = '.bin2hex(random_bytes(4));

    Route::middleware('api')->prefix('api/v1/test-errors')->group(function (): void {
        Route::get('boom', fn () => throw new RuntimeException($this->leak));
        Route::post('validate', function (Request $request): array {
            $request->validate([
                'email' => ['required', 'email'],
                'qty' => ['required', 'integer', 'between:1,20'],
            ]);

            return ['ok' => true];
        });
        Route::get('guest', fn () => throw new AuthenticationException('guest '.$this->leak));
        Route::get('denied', fn () => throw new AuthorizationException('denied '.$this->leak));
        Route::get('missing', fn () => throw (new ModelNotFoundException)->setModel('App\\Models\\User', ['42']));
        Route::get('too-large', fn () => throw new PostTooLargeException);
        Route::get('media', fn () => throw new UnsupportedMediaTypeHttpException('media '.$this->leak));
        Route::get('throttled', fn () => ['ok' => true])->middleware('throttle:1,1');
    });

    Route::middleware('web')->get('test-errors/boom', fn () => throw new RuntimeException($this->leak));
});

function problemKeys(): array
{
    return ['type', 'title', 'status', 'code', 'request_id'];
}

it('turns debug output off outside the local environment', function (): void {
    expect(app()->environment())->toBe('testing')
        ->and(config('app.debug'))->toBeFalse();
});

it('renders a forced API exception as the generic problem body only', function (): void {
    Log::spy();

    $response = $this->getJson('/api/v1/test-errors/boom');

    $response->assertStatus(500)
        ->assertHeader('Content-Type', 'application/problem+json');

    $body = $response->json();
    $raw = (string) $response->getContent();

    expect(array_keys($body))->toBe(problemKeys())
        ->and($body['code'])->toBe('server_error')
        ->and($body['type'])->toBe('https://askida.app/problems/server_error')
        ->and($body['title'])->toBe('An unexpected error occurred.')
        ->and($body['request_id'])->toBe($response->headers->get('X-Request-Id'))
        ->and($raw)->not->toContain('SQLSTATE')
        ->and($raw)->not->toContain('RuntimeException')
        ->and($raw)->not->toContain('select')
        ->and($raw)->not->toContain('.php')
        ->and($raw)->not->toContain('trace');

    Log::shouldHaveReceived('error')->withArgs(
        fn (string $message, array $context): bool => ($context['request_id'] ?? null) === $body['request_id'],
    );
});

it('renders a forced web exception as the generic Turkish page', function (): void {
    $response = $this->get('/test-errors/boom');

    $response->assertStatus(500)
        ->assertSee('Beklenmeyen bir sorun oluştu', false)
        ->assertSee((string) $response->headers->get('X-Request-Id'), false)
        ->assertDontSee('SQLSTATE', false)
        ->assertDontSee('RuntimeException', false)
        ->assertDontSee('.php', false);
});

it('lists validation errors as field and rule code without the submitted value', function (): void {
    $submitted = 'not-an-address-'.bin2hex(random_bytes(5));

    $response = $this->postJson('/api/v1/test-errors/validate', ['email' => $submitted, 'qty' => 99]);

    $response->assertStatus(422)->assertHeader('Content-Type', 'application/problem+json');

    expect($response->json('code'))->toBe('validation.failed')
        ->and($response->json('errors'))->toBe([
            ['field' => 'email', 'code' => 'email'],
            ['field' => 'qty', 'code' => 'between'],
        ])
        ->and((string) $response->getContent())->not->toContain($submitted)
        ->and((string) $response->getContent())->not->toContain('99')
        ->and((string) $response->getContent())->not->toContain('message');
});

it('maps authentication, authorization and missing models', function (string $path, int $status, string $code): void {
    $response = $this->getJson('/api/v1/test-errors/'.$path);

    $response->assertStatus($status)->assertHeader('Content-Type', 'application/problem+json');

    expect(array_keys($response->json()))->toBe(problemKeys())
        ->and($response->json('code'))->toBe($code)
        ->and((string) $response->getContent())->not->toContain($this->leak)
        ->and((string) $response->getContent())->not->toContain('App\\\\Models');
})->with([
    'unauthenticated' => ['guest', 401, 'auth.unauthenticated'],
    'forbidden' => ['denied', 403, 'forbidden'],
    'model not found' => ['missing', 404, 'not_found'],
    'payload too large' => ['too-large', 413, 'payload_too_large'],
    'unsupported media type' => ['media', 415, 'unsupported_media_type'],
]);

it('answers unknown API routes with not_found', function (): void {
    $this->getJson('/api/v1/does-not-exist')
        ->assertStatus(404)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'not_found');

    // No Accept header: the api/ prefix alone selects problem details.
    $this->get('/api/v1/does-not-exist')
        ->assertStatus(404)
        ->assertHeader('Content-Type', 'application/problem+json');
});

it('answers a wrong method with 405 and the Allow header', function (): void {
    $response = $this->deleteJson('/api/v1/test-errors/boom');

    $response->assertStatus(405)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'method_not_allowed');

    expect((string) $response->headers->get('Allow'))->toContain('GET');
});

it('answers throttled requests with 429 rate_limited and Retry-After', function (): void {
    $this->getJson('/api/v1/test-errors/throttled')->assertOk();

    $response = $this->getJson('/api/v1/test-errors/throttled');

    $response->assertStatus(429)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'rate_limited');

    expect((int) $response->headers->get('Retry-After'))->toBeGreaterThan(0);
});

it('renders unknown web pages with the generic page', function (): void {
    $this->get('/sayfa-yok')
        ->assertStatus(404)
        ->assertSee('Aradığınız sayfa bulunamadı', false);
});
