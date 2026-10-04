<?php

use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;

it('renders the problem details shape', function (): void {
    $response = ProblemException::make(ProblemCode::NotFound, 404)->render();
    $body = $response->getData(true);

    expect($response->getStatusCode())->toBe(404)
        ->and($response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($body)->toBe([
            'type' => 'https://askida.app/problems/not_found',
            'title' => 'The resource was not found.',
            'status' => 404,
            'code' => 'not_found',
            'request_id' => null,
        ]);
});

it('reads the request id from the request attributes first, then the header', function (): void {
    request()->headers->set('X-Request-Id', 'from-header');
    expect(ProblemException::make(ProblemCode::Conflict, 409)->render()->getData(true)['request_id'])
        ->toBe('from-header');

    request()->attributes->set('request_id', 'from-attribute');
    expect(ProblemException::make(ProblemCode::Conflict, 409)->render()->getData(true)['request_id'])
        ->toBe('from-attribute');
});

it('passes custom headers through', function (): void {
    $response = ProblemException::make(ProblemCode::Locked, 429, headers: ['Retry-After' => '900'])->render();

    expect($response->getStatusCode())->toBe(429)
        ->and($response->headers->get('Retry-After'))->toBe('900')
        ->and($response->headers->get('Content-Type'))->toBe('application/problem+json');
});

it('exposes errors only as a list of field and code', function (): void {
    $submitted = 'dummy-'.bin2hex(random_bytes(6));

    $response = ProblemException::make(
        ProblemCode::ValidationFailed,
        422,
        errors: [['field' => 'email', 'code' => 'invalid', 'value' => $submitted, 'message' => $submitted]],
    )->render();
    $body = $response->getData(true);

    expect($body['errors'])->toBe([['field' => 'email', 'code' => 'invalid']])
        ->and($response->getContent())->not->toContain($submitted);
});

it('omits errors when there are none', function (): void {
    $body = ProblemException::make(ProblemCode::ServerError, 500)->render()->getData(true);

    expect($body)->not->toHaveKey('errors');
});

it('builds titles and types for every code', function (): void {
    foreach (ProblemCode::cases() as $code) {
        expect($code->title())->not->toBe('')
            ->and($code->type())->toBe('https://askida.app/problems/'.$code->value);
    }
});
