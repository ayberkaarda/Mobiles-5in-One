<?php

use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Services\ShopDirectory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    config(['askida.allow_sample_shops' => false]);
});

function shopsNearQuery(array $extra = []): string
{
    return '/api/v1/shops?'.http_build_query(array_merge(['near' => ShopTestKit::LAT.','.ShopTestKit::LNG], $extra));
}

/**
 * About $metres north of the test point (1 degree of latitude is about 111 km).
 */
function shopsNorthOf(int $metres): GeoPoint
{
    return new GeoPoint(ShopTestKit::LAT + $metres / 111_000, ShopTestKit::LNG);
}

it('lists verified shops within the radius, nearest first, with available counts only', function (): void {
    $far = ShopTestKit::shop(attributes: ['location' => shopsNorthOf(2000), 'name' => 'Uzak']);
    $near = ShopTestKit::shop(attributes: ['location' => shopsNorthOf(300), 'name' => 'Yakın']);
    ShopTestKit::shop(attributes: ['location' => shopsNorthOf(4000), 'name' => 'Çok uzak']);
    ShopTestKit::shop(state: ShopVerificationState::Pending, attributes: ['location' => shopsNorthOf(100)]);
    ShopTestKit::shop(state: ShopVerificationState::Rejected, attributes: ['location' => shopsNorthOf(150)]);

    $bread = ShopTestKit::item($near);
    ShopTestKit::hooks($near, $bread, 3);
    ShopTestKit::hooks($near, $bread, 2, HookStatus::Reserved);
    ShopTestKit::hooks($near, $bread, 1, HookStatus::Redeemed);
    $inactive = ShopTestKit::item($near, ['active' => false]);
    ShopTestKit::hooks($near, $inactive, 4);

    $response = $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson(shopsNearQuery());

    $response->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $near->id)
        ->assertJsonPath('data.0.available_count', 3)
        ->assertJsonPath('data.1.id', $far->id)
        ->assertJsonPath('data.1.available_count', 0)
        ->assertJsonPath('meta.radius', 3000)
        ->assertJsonPath('meta.next_cursor', null);

    expect($response->json('data.0.distance_m'))->toBeGreaterThan(250)->toBeLessThan(350)
        ->and(array_keys($response->json('data.0')))->toBe([
            'id', 'slug', 'name', 'type', 'type_label', 'address', 'il', 'ilce', 'location', 'distance_m', 'available_count', 'is_sample',
        ]);

    $body = (string) $response->getContent();
    expect($body)
        ->not->toContain((string) $near->tax_number_enc)
        ->not->toContain((string) $near->iban_enc)
        ->not->toContain($near->phone)
        ->not->toContain((string) $near->owner_id)
        ->not->toContain('code_hash')
        ->not->toContain('anon_id');
});

it('honours the radius up to 5000 metres and refuses more', function (): void {
    ShopTestKit::shop(attributes: ['location' => shopsNorthOf(4000)]);
    $token = AuthTestKit::token(ShopTestKit::donor());

    $this->withToken($token)->getJson(shopsNearQuery(['radius' => 5000]))->assertOk()->assertJsonCount(1, 'data');
    $this->withToken($token)->getJson(shopsNearQuery(['radius' => 1000]))->assertOk()->assertJsonCount(0, 'data');

    AuthTestKit::assertProblem(
        $this->withToken($token)->getJson(shopsNearQuery(['radius' => 5001])),
        422,
        'validation.failed',
        [['field' => 'radius', 'code' => 'max']],
    );
});

it('filters shops with available units', function (): void {
    $with = ShopTestKit::shop(attributes: ['location' => shopsNorthOf(500)]);
    ShopTestKit::hooks($with, ShopTestKit::item($with), 1);
    $reservedOnly = ShopTestKit::shop(attributes: ['location' => shopsNorthOf(600)]);
    ShopTestKit::hooks($reservedOnly, ShopTestKit::item($reservedOnly), 1, HookStatus::Reserved);
    ShopTestKit::shop(attributes: ['location' => shopsNorthOf(700)]);

    $this->withToken(AuthTestKit::token(ShopTestKit::donor()))
        ->getJson(shopsNearQuery(['hasAvailable' => 1]))
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $with->id);
});

it('lists sample shops only when allowed outside production', function (): void {
    $sample = ShopTestKit::shop(attributes: ['location' => shopsNorthOf(200), 'is_sample' => true]);
    $real = ShopTestKit::shop(attributes: ['location' => shopsNorthOf(400)]);
    $token = AuthTestKit::token(ShopTestKit::donor());

    $this->withToken($token)->getJson(shopsNearQuery())->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $real->id);

    config(['askida.allow_sample_shops' => true]);
    $this->withToken($token)->getJson(shopsNearQuery())->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $sample->id)
        ->assertJsonPath('data.0.is_sample', true);

    // In production the switch is ignored. (A request cannot be sent here: production
    // also enforces HTTPS, so the directory decision is checked directly.)
    app()->detectEnvironment(fn (): string => 'production');

    try {
        expect(app(ShopDirectory::class)->samplesAllowed())->toBeFalse();
    } finally {
        app()->detectEnvironment(fn (): string => 'testing');
    }

    expect(app(ShopDirectory::class)->samplesAllowed())->toBeTrue();
});

it('pages with an opaque cursor in distance order', function (): void {
    $ids = [];

    foreach ([100, 200, 300, 400, 500] as $metres) {
        $ids[] = ShopTestKit::shop(attributes: ['location' => shopsNorthOf($metres)])->id;
    }

    $token = AuthTestKit::token(ShopTestKit::donor());
    $seen = [];
    $cursor = null;

    for ($page = 0; $page < 3; $page++) {
        $response = $this->withToken($token)->getJson(shopsNearQuery(array_filter(['limit' => 2, 'cursor' => $cursor])))->assertOk();
        $seen = [...$seen, ...array_column($response->json('data'), 'id')];
        $cursor = $response->json('meta.next_cursor');

        if ($cursor === null) {
            break;
        }
    }

    expect($seen)->toBe($ids)->and($cursor)->toBeNull();

    AuthTestKit::assertProblem(
        $this->withToken($token)->getJson(shopsNearQuery(['cursor' => 'not-a-cursor'])),
        422,
        'validation.failed',
        [['field' => 'cursor', 'code' => 'invalid']],
    );
});

it('validates the query', function (array $query, array $errors): void {
    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson('/api/v1/shops?'.http_build_query($query)),
        422,
        'validation.failed',
        $errors,
    );
})->with([
    'near missing' => [[], [['field' => 'near', 'code' => 'required'], ['field' => 'near_lat', 'code' => 'required'], ['field' => 'near_lng', 'code' => 'required']]],
    'near outside Türkiye' => [['near' => '48.85,2.35'], [['field' => 'near_lat', 'code' => 'between'], ['field' => 'near_lng', 'code' => 'between']]],
    'near malformed' => [['near' => 'kadikoy'], [['field' => 'near_lat', 'code' => 'required'], ['field' => 'near_lng', 'code' => 'required']]],
    'radius zero' => [['near' => '40.99,29.03', 'radius' => 0], [['field' => 'radius', 'code' => 'min']]],
    'limit too high' => [['near' => '40.99,29.03', 'limit' => 51], [['field' => 'limit', 'code' => 'max']]],
    'hasAvailable odd' => [['near' => '40.99,29.03', 'hasAvailable' => 'yes'], [['field' => 'hasAvailable', 'code' => 'in']]],
]);

it('needs one of the API abilities', function (): void {
    AuthTestKit::assertProblem($this->getJson(shopsNearQuery()), 401, 'auth.unauthenticated');

    $this->withToken(AuthTestKit::token(ShopTestKit::merchant()))->getJson(shopsNearQuery())->assertOk();
});
