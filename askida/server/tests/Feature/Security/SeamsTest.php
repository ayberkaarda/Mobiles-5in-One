<?php

use App\Domain\Auth\Identity\InvalidIdentityToken;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Route;

/*
| Seams between the authentication, error handling and authorization work: each test
| proves that two parts written separately still fit together. The routes under
| api/v1/test-seams exist only inside these tests.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Route::middleware('api')->prefix('api/v1/test-seams')->group(function (): void {
        Route::get('problem', fn () => throw ProblemException::make(ProblemCode::Conflict, 409));
        Route::get('identity', fn () => throw InvalidIdentityToken::because('kid unknown'));
        Route::get('boom', fn () => throw new RuntimeException('database exploded'));
        Route::get('built', fn () => throw new HttpResponseException(
            response()->json(['code' => 'teapot'], 418, ['Content-Type' => 'application/problem+json']),
        ));
    });
});

it('answers an unauthenticated GET /me with the auth.unauthenticated problem', function (): void {
    $response = $this->getJson('/api/v1/me');

    $response->assertStatus(401);

    expect($response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($response->json())->toBe([
            'type' => 'https://askida.app/problems/auth.unauthenticated',
            'title' => ProblemCode::Unauthenticated->title(),
            'status' => 401,
            'code' => 'auth.unauthenticated',
            'request_id' => $response->headers->get('X-Request-Id'),
        ]);
});

it('answers an unauthenticated GET /me without a JSON Accept header the same way', function (): void {
    $response = $this->get('/api/v1/me', ['Accept' => 'text/html']);

    $response->assertStatus(401);

    expect($response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($response->json('code'))->toBe('auth.unauthenticated');
});

it('does not report problem exceptions, including subclasses, to the error log', function (): void {
    Exceptions::fake();

    $this->getJson('/api/v1/test-seams/problem')->assertStatus(409)->assertJsonPath('code', 'conflict');
    $this->getJson('/api/v1/test-seams/identity')->assertStatus(401)->assertJsonPath('code', 'auth.token_invalid');

    Exceptions::assertNothingReported();
});

it('still reports unexpected exceptions', function (): void {
    Exceptions::fake();

    $this->getJson('/api/v1/test-seams/boom')->assertStatus(500)->assertJsonPath('code', 'server_error');

    Exceptions::assertReported(RuntimeException::class);
});

it('sends a response built by the application unchanged', function (): void {
    $response = $this->getJson('/api/v1/test-seams/built');

    $response->assertStatus(418)->assertExactJson(['code' => 'teapot']);
});

it('renders the named auth limiter response as a rate_limited problem', function (): void {
    foreach (range(1, 5) as $i) {
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.77'])->postJson('/api/v1/auth/forgot', []);
    }

    $response = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.77'])->postJson('/api/v1/auth/forgot', []);

    $response->assertStatus(429);

    expect($response->json('code'))->toBe('rate_limited')
        ->and($response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and((int) $response->headers->get('Retry-After'))->toBeGreaterThan(0);
});

it('keeps every problem code from both work packages with a title and a type', function (): void {
    $required = [
        // shared contract
        'validation.failed', 'auth.invalid_credentials', 'auth.locked', 'auth.unauthenticated',
        'auth.email_unverified', 'auth.token_invalid', 'forbidden', 'not_found', 'conflict',
        'rate_limited', 'payload_too_large', 'unsupported_media_type', 'server_error',
        // error handling additions
        'bad_request', 'method_not_allowed', 'https_required', 'service_unavailable',
    ];

    $values = array_map(static fn (ProblemCode $code): string => $code->value, ProblemCode::cases());

    expect(array_diff($required, $values))->toBe([])
        ->and(array_unique($values))->toHaveCount(count($values));

    foreach (ProblemCode::cases() as $code) {
        expect($code->title())->not->toBe('')
            ->and($code->type())->toBe('https://askida.app/problems/'.$code->value)
            ->and(preg_match('/^[a-z_]+(\.[a-z_]+)?$/', $code->value))->toBe(1);
    }
});
