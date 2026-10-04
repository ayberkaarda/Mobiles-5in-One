<?php

it('renders the welcome page with its inline style allowed by the CSP nonce', function (): void {
    $response = $this->get('/');

    $response->assertOk()->assertSee('Askıda');

    $csp = (string) $response->headers->get('Content-Security-Policy');

    expect(preg_match("/style-src [^;]*'nonce-([A-Za-z0-9+\\/]+)'/", $csp, $match))->toBe(1);

    $html = (string) $response->getContent();

    expect(substr_count($html, '<style'))->toBe(1)
        ->and($html)->toContain('<style nonce="'.$match[1].'">')
        ->and($html)->not->toContain('style="');
});

it('issues a different nonce on every request', function (): void {
    $first = (string) $this->get('/')->headers->get('Content-Security-Policy');
    $second = (string) $this->get('/')->headers->get('Content-Security-Policy');

    expect($first)->not->toBe($second);
});
