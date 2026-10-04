<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\Datasets\RouteClassification;
use Tests\Security\IdorHarness;
use Tests\Security\RouteWorld;

/*
| Security checklist items 3 and 4 at the route level: every /api/v1 route is classified
| (public, user, merchant, anon) with the token abilities that reach it, the route
| middleware agrees with that classification, and real tokens of every principal get
| the answer the classification promises: 401 `auth.unauthenticated` for guests,
| revoked tokens, deactivated accounts and tokens of the wrong kind of principal on
| user routes; 403 `forbidden` for a user token on anon routes, a donor on merchant
| routes and staff on owner-only routes.
*/

uses(RefreshDatabase::class);

/**
 * Every /api/v1 route keyed like the dataset.
 *
 * @return array<string, RoutingRoute>
 */
function classifiedApiRoutes(): array
{
    $routes = [];

    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/')) {
            continue;
        }

        $method = array_values(array_diff($route->methods(), ['HEAD']))[0] ?? 'GET';
        $routes[$method.' '.$route->uri()] = $route;
    }

    ksort($routes);

    return $routes;
}

/**
 * Abilities named by `ability:` / `abilities:` middleware of the route.
 *
 * @return list<string>|null null when the route has no ability middleware
 */
function routeAbilityMiddleware(RoutingRoute $route): ?array
{
    $abilities = null;

    foreach ($route->gatherMiddleware() as $middleware) {
        if (is_string($middleware) && preg_match('/^abilit(?:y|ies):(.+)$/', $middleware, $match) === 1) {
            $abilities = array_merge($abilities ?? [], explode(',', $match[1]));
        }
    }

    return $abilities;
}

/**
 * What the principal must get on a route of that classification: 'reach' (the action
 * runs, whatever its own answer), 401 or 403.
 *
 * @param  array{class: string, abilities: list<string>, shop?: string, gaps?: array<string, string>}  $entry
 */
function expectedOutcome(array $entry, string $principal): string|int
{
    if (array_key_exists($principal, $entry['gaps'] ?? [])) {
        return 401;
    }

    if (in_array($principal, ['guest', 'revoked', 'deactivated', 'banned-anon'], true)) {
        return $entry['class'] === 'public' && $principal === 'guest' ? 'reach' : 401;
    }

    $kind = match ($principal) {
        'donor' => 'donor',
        'owner', 'staff' => 'merchant',
        'anon' => 'anon',
        default => throw new LogicException("Unknown principal {$principal}."),
    };

    if ($kind === 'anon') {
        // A device token is refused by authentication everywhere it is not allowed.
        return in_array('anon', $entry['abilities'], true) ? 'reach' : 401;
    }

    if (! in_array($kind, $entry['abilities'], true)) {
        return 403;
    }

    if ($entry['class'] === 'merchant' && $principal === 'staff') {
        return ($entry['shop'] ?? null) === 'member' ? 'reach' : 403;
    }

    return 'reach';
}

/**
 * @return array<string, array{0: string, 1: string}>
 */
function classificationCases(): array
{
    $cases = [];

    foreach (RouteClassification::routes() as $key => $entry) {
        $principals = match ($entry['class']) {
            'public' => ['guest'],
            'user' => ['guest', 'anon', 'donor', 'owner', 'staff', 'deactivated', 'revoked'],
            'merchant' => ['guest', 'anon', 'donor', 'owner', 'staff', 'deactivated', 'revoked'],
            'anon' => ['guest', 'anon', 'banned-anon', 'donor', 'owner', 'deactivated', 'revoked'],
            default => [],
        };

        foreach ($principals as $principal) {
            $expected = expectedOutcome($entry, $principal);
            $cases["{$key} | {$principal} -> {$expected}"] = [$key, $principal];
        }
    }

    return $cases;
}

function sendClassified(IdorHarness $harness, RouteWorld $world, string $key, string $principal): TestResponse
{
    $entry = RouteClassification::routes()[$key];
    [$method, $uri] = explode(' ', $key, 2);
    $token = $world->token($principal, $entry['class']);

    return $harness->call(
        $method,
        $world->uri($uri, $entry['query'] ?? null),
        $token,
        $world->payload($entry['payload'] ?? null),
    );
}

it('classifies every api route and has a route for every classification', function (): void {
    $routes = array_keys(classifiedApiRoutes());
    $classified = array_keys(RouteClassification::routes());
    sort($classified);

    expect(array_values(array_diff($routes, $classified)))->toBe([], 'unclassified routes')
        ->and(array_values(array_diff($classified, $routes)))->toBe([], 'classified routes that do not exist')
        ->and(count($routes))->toBeGreaterThanOrEqual(27);
});

it('uses only known classes, abilities and shop rules', function (string $key): void {
    $entry = RouteClassification::routes()[$key];

    expect(RouteClassification::CLASSES)->toContain($entry['class']);

    foreach ($entry['abilities'] as $ability) {
        expect(['donor', 'merchant', 'anon'])->toContain($ability);
    }

    match ($entry['class']) {
        'public' => expect($entry['abilities'])->toBe([]),
        'anon' => expect($entry['abilities'])->toBe(['anon']),
        'merchant' => expect($entry['abilities'])->toBe(['merchant'])
            ->and(RouteClassification::SHOP_RULES)->toContain($entry['shop'] ?? ''),
        'user' => expect(array_intersect(['donor', 'merchant'], $entry['abilities']))->not->toBe([]),
        default => throw new LogicException('unreachable'),
    };

    foreach (array_keys($entry['gaps'] ?? []) as $principal) {
        expect($entry['abilities'])->toContain($principal);
    }
})->with(array_keys(RouteClassification::routes()));

it('matches the route middleware to the classification', function (string $key): void {
    $entry = RouteClassification::routes()[$key];
    $route = classifiedApiRoutes()[$key] ?? null;

    expect($route)->not->toBeNull();
    assert($route instanceof RoutingRoute);

    $middleware = $route->gatherMiddleware();
    $declared = routeAbilityMiddleware($route);
    $reachable = array_values(array_diff($entry['abilities'], array_keys($entry['gaps'] ?? [])));

    if ($entry['class'] === 'public') {
        expect($middleware)->not->toContain('auth:sanctum')
            ->and($declared)->toBeNull();

        return;
    }

    expect($middleware)->toContain('auth:sanctum');

    // A device token needs an explicit anon ability middleware; nothing else may carry one.
    $anonMiddleware = array_intersect(['abilities:anon', 'ability:anon'], $middleware) !== [];
    expect($anonMiddleware)->toBe(in_array('anon', $reachable, true));

    if ($declared !== null) {
        $sortedDeclared = $declared;
        $sortedReachable = $reachable;
        sort($sortedDeclared);
        sort($sortedReachable);

        expect($sortedDeclared)->toBe($sortedReachable);
    }
})->with(array_keys(RouteClassification::routes()));

it('answers every principal as the classification promises', function (string $key, string $principal): void {
    $entry = RouteClassification::routes()[$key];
    $expected = expectedOutcome($entry, $principal);

    $response = sendClassified(new IdorHarness($this), new RouteWorld, $key, $principal);

    if ($expected === 'reach') {
        $refusals = ['auth.unauthenticated', 'forbidden', 'not_found', 'method_not_allowed'];
        $body = (string) $response->getContent();
        $code = $body === '' ? null : data_get(json_decode($body, true), 'code');

        expect($response->status())->toBeLessThan(500, $body)
            ->and(in_array($code, $refusals, true))->toBeFalse("{$key} refused {$principal}: {$body}");

        return;
    }

    IdorHarness::assertProblem($response, $expected);
    expect($response->json())->toHaveKeys(['type', 'title', 'status', 'code', 'request_id'])
        ->and(array_keys($response->json()))->toHaveCount(5);
})->with(classificationCases());
