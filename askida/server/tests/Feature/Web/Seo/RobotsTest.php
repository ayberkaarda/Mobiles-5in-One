<?php

use Illuminate\Support\Facades\Cache;

beforeEach(function (): void {
    config(['web.origin' => 'https://askida.app']);
});

it('allows everything except the private areas and names the sitemap', function (): void {
    $response = $this->get('/robots.txt')
        ->assertOk()
        ->assertHeader('Content-Type', 'text/plain; charset=utf-8');

    expect($response->getContent())->toBe(implode("\n", [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /pay/',
        'Disallow: /hesap-silme',
        'Disallow: /og/',
        '',
        'Sitemap: https://askida.app/sitemap.xml',
    ])."\n");
});

it('names the sitemap on the configured origin, never the request host', function (): void {
    config(['web.origin' => 'https://ornek.askida.app']);

    expect($this->get('http://evil.example/robots.txt')->assertOk()->getContent())
        ->toContain('Sitemap: https://ornek.askida.app/sitemap.xml')
        ->not->toContain('evil.example');
});

it('is served by the application and cached like a public page', function (): void {
    config(['responsecache.enabled' => true, 'responsecache.store' => 'array']);
    Cache::store('array')->flush();

    expect(file_exists(public_path('robots.txt')))->toBeFalse();

    $this->get('/robots.txt')->assertHeader('X-Page-Cache', 'miss');
    $this->get('/robots.txt')->assertHeader('X-Page-Cache', 'hit')->assertHeader('Content-Type', 'text/plain; charset=utf-8');
});
