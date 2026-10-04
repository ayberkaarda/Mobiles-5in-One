<?php

use App\Domain\Auth\Abilities\AdminPermission;
use App\Providers\AuthServiceProvider;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Tests\Datasets\AuthorizationMatrix;
use Tests\Security\AuthzScenario;
use Tests\Security\MatrixDocument;

/*
| Security checklist item 3: table-driven tests over every cell of
| docs/security/authorization-matrix.md. The dataset in tests/Datasets mirrors the
| document and the first test proves they are identical.
*/

uses(RefreshDatabase::class);

/**
 * @return array<string, array{0: string, 1: string, 2: string, 3: array<int, mixed>}>
 */
function matrixCells(string $type): array
{
    $cases = [];

    foreach (AuthorizationMatrix::rows() as $key => $row) {
        foreach ($row['checks'] as $check) {
            if ($check[0] !== $type) {
                continue;
            }

            $label = $check[0] === 'policy' ? class_basename($check[1]).'::'.$check[2] : $check[1];

            foreach ($row['cells'] as $principal => $cell) {
                $cases["{$key} | {$label} | {$principal} = {$cell}"] = [$key, $principal, $cell, $check];
            }
        }
    }

    return $cases;
}

/**
 * Every API principal against every admin check, and every admin principal against
 * every API policy check: all must be denied.
 *
 * @return array<string, array{0: string, 1: string, 2: array<int, mixed>}>
 */
function matrixCrossPrincipals(): array
{
    $cases = [];

    foreach (AuthorizationMatrix::rows() as $key => $row) {
        $isAdminRow = $row['section'] === '4';
        $others = $isAdminRow ? AuthorizationMatrix::API_PRINCIPALS : AuthorizationMatrix::ADMIN_PRINCIPALS;

        foreach ($row['checks'] as $check) {
            if (! in_array($check[0], ['policy', 'gate'], true)) {
                continue;
            }

            $label = $check[0] === 'policy' ? class_basename($check[1]).'::'.$check[2] : $check[1];

            foreach ($others as $principal) {
                $cases["{$key} | {$label} | {$principal} denied"] = [$key, $principal, $check];
            }
        }
    }

    return $cases;
}

/**
 * @return array<string, array{0: string, 1: array<int, mixed>}>
 */
function matrixRowsWith(string $type): array
{
    $cases = [];

    foreach (AuthorizationMatrix::rows() as $key => $row) {
        foreach ($row['checks'] as $check) {
            if ($check[0] === $type) {
                $prefix = $type === 'pending' ? 'PENDING: ' : '';
                $cases["{$prefix}{$key} ({$check[1]})"] = [$key, $check];
            }
        }
    }

    return $cases;
}

/**
 * @param  array<int, mixed>  $check
 */
function inspectMatrixCheck(AuthzScenario $scenario, string $principal, array $check): Response
{
    $gate = Gate::forUser($scenario->actor($principal));

    return match ($check[0]) {
        'policy' => $gate->inspect($check[2], $scenario->arguments($check[3])),
        'gate' => $gate->inspect($check[1]),
        default => throw new LogicException('Not an authorization check: '.$check[0]),
    };
}

/**
 * Routes whose URI and one of whose methods match the matrix row key.
 *
 * @return list<RoutingRoute>
 */
function routesForMatrixKey(string $key, string $section): array
{
    [$methods, $path] = explode(' ', $key, 2);
    $path = explode('?', $path)[0];
    $uri = $section === '3.6' && str_starts_with($path, 'pay/') ? $path : 'api/v1/'.$path;

    return array_values(array_filter(
        Route::getRoutes()->getRoutes(),
        static fn (RoutingRoute $route): bool => $route->uri() === $uri
            && array_intersect(explode('/', $methods), $route->methods()) !== [],
    ));
}

it('mirrors every row and cell of the authorization matrix document', function (): void {
    $document = MatrixDocument::rows();
    $dataset = array_map(static fn (array $row): array => $row['cells'], AuthorizationMatrix::rows());

    expect(array_keys($document))->toBe(array_keys($dataset))
        ->and($document)->toBe($dataset)
        ->and(count($document))->toBeGreaterThan(40);
});

it('reads tables, not prose, from the matrix document', function (): void {
    $markdown = <<<'MD'
    | Method | Path        | guest | donor | owner | staff | anon | Notes |
    | ------ | ----------- | ----- | ----- | ----- | ----- | ---- | ----- |
    | GET    | `things`    | -     | own   | -     | -     | Y    | text  |

    | Operation   | mod | fin | admin | Notes |
    | ----------- | --- | --- | ----- | ----- |
    | Do a thing  | Y   | -   | Y     | text  |

    | Rule | Statement |
    | ---- | --------- |
    | AN-9 | ignored   |
    MD;

    expect(MatrixDocument::rows($markdown))->toBe([
        'GET things' => ['guest' => '-', 'donor' => 'own', 'owner' => '-', 'staff' => '-', 'anon' => 'Y'],
        'Do a thing' => ['mod' => 'Y', 'fin' => '-', 'admin' => 'Y'],
    ]);
});

it('enforces the policy cell', function (string $key, string $principal, string $cell, array $check): void {
    $response = inspectMatrixCheck(new AuthzScenario, $principal, $check);
    $allowed = in_array($cell, ['Y', 'own', 'member'], true);

    expect($response->allowed())->toBe($allowed);

    if (! $allowed && $principal !== 'guest') {
        // A matrix principal is denied by ability or role, never by scope: 403.
        expect($response->status())->toBe(403)->and($response->code())->toBe('forbidden');
    }
})->with(matrixCells('policy'));

it('enforces the admin gate cell', function (string $key, string $principal, string $cell, array $check): void {
    $response = inspectMatrixCheck(new AuthzScenario, $principal, $check);

    expect($response->allowed())->toBe($cell === 'Y');
})->with(matrixCells('gate'));

it('denies principals from the other side of the matrix', function (string $key, string $principal, array $check): void {
    expect(inspectMatrixCheck(new AuthzScenario, $principal, $check)->allowed())->toBeFalse();
})->with(matrixCrossPrincipals());

it('serves the existing identity endpoint with the matrix authentication rule', function (string $key, array $check): void {
    $row = AuthorizationMatrix::rows()[$key];
    $route = Route::getRoutes()->getByName($check[1]);

    expect($route)->not->toBeNull()
        ->and(routesForMatrixKey($key, $row['section']))->toContain($route);

    $middleware = $route?->gatherMiddleware() ?? [];

    // Section 3.6 rows have no principal columns: they are reached without a bearer token
    // (provider deliveries and payment pages authenticate by signature or token lookup).
    if (($row['cells']['guest'] ?? 'Y') === 'Y') {
        expect($middleware)->not->toContain('auth:sanctum');
    } else {
        expect($middleware)->toContain('auth:sanctum');
    }
})->with(matrixRowsWith('route'));

it('keeps pending rows honest: the endpoint is still absent', function (string $key, array $check): void {
    $row = AuthorizationMatrix::rows()[$key];

    expect(routesForMatrixKey($key, $row['section']))->toBe([]);
})->with(matrixRowsWith('pending'));

it('offers no way to an operation that must not exist', function (string $key, array $check): void {
    $names = array_merge(
        array_keys(Gate::abilities()),
        array_map(static fn (AdminPermission $permission): string => $permission->value, AdminPermission::cases()),
    );

    foreach (AuthServiceProvider::POLICIES as $policy) {
        $names = array_merge($names, get_class_methods($policy));
    }

    foreach ($names as $name) {
        expect(strtolower($name))->not->toContain('recipient')->not->toContain('impersonat'.'e_');
    }
})->with(matrixRowsWith('absent'));

it('has a matrix row for every policy method and a policy method for every row', function (): void {
    $referenced = [];

    foreach (AuthorizationMatrix::rows() as $row) {
        foreach ($row['checks'] as $check) {
            if ($check[0] === 'policy') {
                expect(method_exists($check[1], $check[2]))->toBeTrue("{$check[1]}::{$check[2]} is missing")
                    ->and(AuthServiceProvider::POLICIES)->toContain($check[1]);
                $referenced[] = $check[1].'::'.$check[2];
            }
        }
    }

    $declared = [];

    foreach (AuthServiceProvider::POLICIES as $policy) {
        foreach ((new ReflectionClass($policy))->getMethods(ReflectionMethod::IS_PUBLIC) as $method) {
            if ($method->getName() !== 'before' && ! $method->isStatic()) {
                $declared[] = $policy.'::'.$method->getName();
            }
        }
    }

    sort($referenced);
    sort($declared);

    expect(array_values(array_unique($referenced)))->toBe($declared);
});

it('has a matrix row for every gate and a gate for every row', function (): void {
    $referenced = [];

    foreach (AuthorizationMatrix::rows() as $row) {
        foreach ($row['checks'] as $check) {
            if ($check[0] === 'gate') {
                $referenced[] = $check[1];
            }
        }
    }

    $defined = array_keys(Gate::abilities());

    sort($referenced);
    sort($defined);

    expect($referenced)->toBe($defined);
});

it('registers a policy for every protected domain model', function (): void {
    foreach (AuthServiceProvider::POLICIES as $model => $policy) {
        expect(Gate::getPolicyFor($model))->toBeInstanceOf($policy);
    }
});
