<?php

it('renders the welcome page with its inline style allowed by the CSP nonce', function (): void {
    $response = $this->get('/');

    $response->assertOk()->assertSee('Askıda');

    $csp = (string) $response->headers->get('Content-Security-Policy');

    expect(preg_match("/style-src [^;]*'nonce-([A-Za-z0-9+\\/]+)'/", $csp, $match))->toBe(1);

    $html = (string) $response->getContent();

    preg_match_all('/<style\b[^>]*>/', $html, $tags);

    // Livewire may inject its own style block once it has booted; it must carry the
    // nonce as well.
    expect($tags[0])->toContain('<style nonce="'.$match[1].'">')
        ->and($html)->not->toContain('style="');

    foreach ($tags[0] as $tag) {
        expect($tag)->toContain('nonce="'.$match[1].'"');
    }
});

it('issues a different nonce on every request', function (): void {
    $first = (string) $this->get('/')->headers->get('Content-Security-Policy');
    $second = (string) $this->get('/')->headers->get('Content-Security-Policy');

    expect($first)->not->toBe($second);
});
