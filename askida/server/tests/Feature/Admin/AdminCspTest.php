<?php

use App\Domain\Auth\Abilities\AdminRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Admin\Support\AdminTestKit;

/*
| The admin surface loads nothing from a third party: no font host, no avatar host.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

it('lists no external host in the admin policy on the login and the signed-in pages', function (): void {
    $login = $this->get('/admin/login')->assertOk();

    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));
    $dashboard = $this->get('/admin')->assertOk();

    foreach ([$login, $dashboard] as $response) {
        $csp = (string) $response->headers->get('Content-Security-Policy');
        expect($csp)->not->toContain('bunny')->not->toContain('ui-avatars')->not->toContain('https://')
            ->and($csp)->toContain("img-src 'self' data:")
            ->and($csp)->toContain("font-src 'self' data:");

        $html = (string) $response->getContent();
        expect($html)->not->toContain('fonts.bunny.net')->not->toContain('ui-avatars.com');
    }
});

it('draws the avatar as an inline data image', function (): void {
    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Admin));
    $html = (string) $this->get('/admin')->assertOk()->getContent();

    expect($html)->toContain('data:image/svg+xml;base64,');
});
