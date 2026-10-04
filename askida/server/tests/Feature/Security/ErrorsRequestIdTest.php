<?php

it('generates a request id when none is sent', function (): void {
    $response = $this->get('/up');

    expect((string) $response->headers->get('X-Request-Id'))
        ->toMatch('/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/');
});

it('keeps a well-formed inbound request id', function (): void {
    $inbound = 'edge-'.bin2hex(random_bytes(6));

    $this->get('/up', ['X-Request-Id' => $inbound])
        ->assertHeader('X-Request-Id', $inbound);
});

it('replaces a malformed inbound request id', function (string $inbound): void {
    $response = $this->get('/up', ['X-Request-Id' => $inbound]);

    expect($response->headers->get('X-Request-Id'))->not->toBe($inbound)
        ->and((string) $response->headers->get('X-Request-Id'))->toMatch('/^[0-9a-f-]{36}$/');
})->with([
    'too short' => ['abc'],
    'too long' => [str_repeat('a', 65)],
    'unsafe characters' => ['abcd<script>efgh'],
    'header injection' => ["abcdefgh\r\nSet-Cookie: x=y"],
]);

it('puts the request id into problem bodies', function (): void {
    $inbound = 'trace-'.bin2hex(random_bytes(6));

    $this->getJson('/api/v1/nope', ['X-Request-Id' => $inbound])
        ->assertStatus(404)
        ->assertHeader('X-Request-Id', $inbound)
        ->assertJsonPath('request_id', $inbound);
});
