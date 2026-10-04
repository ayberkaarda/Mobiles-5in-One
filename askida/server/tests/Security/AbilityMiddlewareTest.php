<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Router;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Laravel\Sanctum\Http\Middleware\CheckForAnyAbility;
use Tests\Security\IdorHarness;

/*
| Token abilities mirror roles: routes guarded with ability:<name> refuse every other
| ability with a 403 `forbidden` problem, and guests with 401.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    require __DIR__.'/routes/abilities.php';
    $this->harness = new IdorHarness($this);
});

it('registers the Sanctum ability middleware aliases', function (): void {
    $aliases = app(Router::class)->getMiddleware();

    expect($aliases['ability'] ?? null)->toBe(CheckForAnyAbility::class)
        ->and($aliases['abilities'] ?? null)->toBe(CheckAbilities::class);
});

it('lets each user ability through its own route only', function (string $kind, array $allowed): void {
    $token = IdorHarness::bearer(User::factory()->state(['kind' => $kind])->create());

    foreach (['donor', 'merchant', 'anon', 'user', 'all'] as $route) {
        $response = $this->harness->call('GET', '/api/v1/test-abilities/'.$route, $token);

        if (in_array($route, $allowed, true)) {
            $response->assertOk()->assertJsonPath('ability', $route);
        } else {
            IdorHarness::assertProblem($response, 403);
            expect($response->json())->toHaveKeys(['type', 'title', 'status', 'code', 'request_id'])
                ->and($response->json())->toHaveCount(5);
        }
    }
})->with([
    'donor token' => ['donor', ['donor', 'user']],
    'merchant token' => ['merchant', ['merchant', 'user']],
]);

it('answers guests with 401 before any ability check', function (string $route): void {
    IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/test-abilities/'.$route, null), 401);
})->with(['donor', 'merchant', 'anon', 'user', 'all']);

it('never lets a user token carry the anon ability', function (): void {
    $user = User::factory()->donor()->create();
    $token = $user->createToken('forged-device', ['anon'])->plainTextToken;

    IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/test-abilities/anon', $token), 401);
});
