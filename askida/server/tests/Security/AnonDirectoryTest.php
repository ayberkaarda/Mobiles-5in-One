<?php

use App\Domain\Anon\Auth\AnonTokenRule;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\IdorHarness;

/*
| Recipients find shops through the directory reads (matrix 3.2: anon Y on GET shops and
| GET shops/{slug}) with their anon device token, and nowhere else outside the anon
| routes. Guests stay out (decision D-1).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    HookWorld::pepper();
    $this->harness = new IdorHarness($this);
});

it('lists and shows verified shops to an anon device without owner contact data', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    ShopTestKit::item($shop);
    $hidden = ShopTestKit::shop(null, ShopVerificationState::Pending);
    $token = HookWorld::anonToken(HookWorld::anon());

    $list = $this->harness->call('GET', '/api/v1/shops?near='.ShopTestKit::LAT.','.ShopTestKit::LNG, $token)->assertOk();
    $show = $this->harness->call('GET', '/api/v1/shops/'.$shop->slug, $token)->assertOk();

    expect(array_column((array) $list->json('data'), 'id'))->toBe([$shop->id])
        ->and($show->json('data.id'))->toBe($shop->id);

    foreach ([$list, $show] as $response) {
        $body = (string) $response->getContent();

        expect($body)->not->toContain($owner->email)
            ->not->toContain($owner->id)
            ->not->toContain((string) $shop->phone)
            ->not->toContain('tax_number')
            ->not->toContain('iban')
            ->not->toContain('anon_id');
    }

    IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/shops/'.$hidden->slug, $token), 404);
});

it('still refuses guests on the directory reads', function (): void {
    $shop = ShopTestKit::shop();

    IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/shops?near='.ShopTestKit::LAT.','.ShopTestKit::LNG, null), 401);
    IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/shops/'.$shop->slug, null), 401);
});

it('keeps an anon device out of every other shop route', function (string $method, string $suffix): void {
    $shop = ShopTestKit::shop();
    $token = HookWorld::anonToken(HookWorld::anon());

    $response = $this->harness->call($method, '/api/v1/shops'.str_replace('{id}', $shop->id, $suffix), $token, ShopTestKit::payload());

    IdorHarness::assertProblem($response, 401);
})->with([
    'open a shop' => ['POST', ''],
    'change a shop' => ['PATCH', '/{id}'],
    'read the catalog' => ['GET', '/{id}/items'],
    'redeem' => ['POST', '/{id}/redeem'],
]);

it('admits a device token only on any-of lists naming anon or on anon-only routes', function (array $middleware, bool $admits): void {
    $route = (new RoutingRoute(['GET'], 'probe', fn (): null => null))->middleware($middleware);

    expect(AnonTokenRule::routeAdmitsAnon($route))->toBe($admits);
})->with([
    'anon only (all of)' => [['auth:sanctum', 'abilities:anon'], true],
    'anon only (any of)' => [['auth:sanctum', 'ability:anon'], true],
    'any of the three' => [['auth:sanctum', 'ability:donor,merchant,anon'], true],
    'users only' => [['auth:sanctum', 'ability:donor,merchant'], false],
    'all of anon and donor' => [['auth:sanctum', 'abilities:donor,anon'], false],
    'a name that only contains anon' => [['auth:sanctum', 'ability:anonymous'], false],
    'no ability middleware' => [['auth:sanctum'], false],
]);

it('admits device tokens on the directory reads and the anon routes only', function (): void {
    $admitting = [];

    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (str_starts_with($route->uri(), 'api/v1/') && AnonTokenRule::routeAdmitsAnon($route)) {
            $admitting[] = (string) $route->getName();
        }
    }

    sort($admitting);

    expect($admitting)->toBe(['api.v1.anon.me.destroy', 'api.v1.hooks.reserve', 'api.v1.shops.index', 'api.v1.shops.show']);
});
