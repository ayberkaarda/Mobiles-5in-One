<?php

use App\Http\Middleware\LimitRequestBody;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;

/*
| Security checklist item 6 (body limit): 1 MB in general and 6 MB for shop documents,
| the same limits as nginx; larger bodies get 413 payload_too_large.
*/

beforeEach(function (): void {
    Route::middleware('api')->post('api/v1/test-body/echo', fn (Request $request) => ['size' => strlen((string) $request->getContent())]);
    Route::middleware('api')->post('api/v1/shops/{shop}/documents', fn () => ['ok' => true]);
    Route::middleware('web')->post('test-body/form', fn () => 'ok');
});

/**
 * A JSON body of exactly $bytes bytes.
 */
function jsonBodyOfSize(int $bytes): string
{
    $overhead = strlen('{"pad":""}');

    return '{"pad":"'.str_repeat('a', $bytes - $overhead).'"}';
}

function postRaw(string $uri, string $body, string $accept = 'application/json'): TestResponse
{
    return test()->call('POST', $uri, [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_ACCEPT' => $accept,
        'CONTENT_LENGTH' => (string) strlen($body),
    ], $body);
}

it('accepts an API body at the general limit', function (): void {
    postRaw('/api/v1/test-body/echo', jsonBodyOfSize(LimitRequestBody::DEFAULT_LIMIT))
        ->assertOk()
        ->assertJsonPath('size', LimitRequestBody::DEFAULT_LIMIT);
});

it('rejects an API body one byte over the limit with payload_too_large', function (): void {
    postRaw('/api/v1/test-body/echo', jsonBodyOfSize(LimitRequestBody::DEFAULT_LIMIT + 1))
        ->assertStatus(413)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('code', 'payload_too_large');
});

it('allows up to 6 MB on the shop document endpoints only', function (): void {
    postRaw('/api/v1/shops/abc/documents', jsonBodyOfSize(2 * 1024 * 1024))->assertOk();

    postRaw('/api/v1/shops/abc/documents', jsonBodyOfSize(LimitRequestBody::DOCUMENT_LIMIT + 1))
        ->assertStatus(413)
        ->assertJsonPath('code', 'payload_too_large');
});

it('rejects an oversized body sent without a Content-Length header', function (): void {
    $body = jsonBodyOfSize(LimitRequestBody::DEFAULT_LIMIT + 10);

    test()->call('POST', '/api/v1/test-body/echo', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_ACCEPT' => 'application/json',
    ], $body)->assertStatus(413);
});

it('answers an oversized web form with the generic page', function (): void {
    postRaw('/test-body/form', jsonBodyOfSize(LimitRequestBody::DEFAULT_LIMIT + 1), 'text/html')
        ->assertStatus(413)
        ->assertSee('İsteğiniz işlenemedi', false);
});
