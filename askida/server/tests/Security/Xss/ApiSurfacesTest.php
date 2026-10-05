<?php

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Datasets\XssPayloads;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\Xss\XssWorld;

uses(RefreshDatabase::class);

/*
| Stored-XSS sweep, API surfaces (security checklist item 16). The API never renders HTML:
| the contract is that a stored string comes back byte-identical inside a JSON string
| (JSON escaping does the encoding), with a JSON content type and `nosniff` so that no
| client ever treats the body as markup.
*/

beforeEach(function (): void {
    AuthTestKit::boot();
    config(['askida.allow_sample_shops' => false]);
});

/**
 * Asserts the JSON envelope: JSON content type, nosniff, and a body that decodes.
 *
 * @return array<string, mixed>
 */
function jsonSurface(TestResponse $response): array
{
    $response->assertOk();

    expect((string) $response->headers->get('Content-Type'))->toStartWith('application/json')
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff');

    $decoded = json_decode((string) $response->getContent(), true, flags: JSON_THROW_ON_ERROR);

    expect($decoded)->toBeArray();

    /** @var array<string, mixed> $decoded */
    return $decoded;
}

it('returns payloads from the shop endpoints as inert JSON strings', function (string $payload): void {
    $world = XssWorld::listedShop($this, $payload);
    /** @var Shop $shop */
    $shop = $world['shop'];
    /** @var Item $item */
    $item = $world['item'];
    $viewer = AuthTestKit::token(ShopTestKit::donor());

    $detail = jsonSurface($this->withToken($viewer)->getJson('/api/v1/shops/'.$shop->slug));
    expect($detail['data']['name'])->toBe($shop->name)
        ->and($detail['data']['address'])->toBe($shop->address)
        ->and($detail['data']['il'])->toBe($shop->il)
        ->and($detail['data']['ilce'])->toBe($shop->ilce);

    $near = ShopTestKit::LAT.','.ShopTestKit::LNG;
    $list = jsonSurface($this->withToken($viewer)->getJson('/api/v1/shops?'.http_build_query(['near' => $near, 'radius' => 5])));
    expect(array_column($list['data'], 'name'))->toContain($shop->name);

    $items = jsonSurface($this->withToken($world['token'])->getJson("/api/v1/shops/{$shop->id}/items"));
    expect(array_column($items['data'], 'name'))->toContain($item->name);

    $mine = jsonSurface($this->withToken($world['token'])->getJson('/api/v1/me/shops'));
    expect(array_column($mine['data'], 'name'))->toContain($shop->name);
})->with(XssPayloads::everything());

it('stores a donor name payload through PATCH me and returns it as a JSON string', function (string $payload): void {
    $donor = ShopTestKit::donor();
    $token = AuthTestKit::token($donor);
    $name = XssPayloads::fit($payload, XssWorld::ME_NAME_MAX, 'Ayşe');

    $patched = $this->withToken($token)->patchJson('/api/v1/me', ['name' => $name]);
    $patched->assertOk();

    $stored = User::query()->findOrFail($donor->id)->name;
    $me = jsonSurface($this->withToken($token)->getJson('/api/v1/me'));

    expect($stored)->toBe(trim($name))
        ->and($me['data']['name'])->toBe($stored)
        ->and((string) $patched->headers->get('Content-Type'))->toStartWith('application/json');
})->with(XssPayloads::everything());

it('refuses over-long payloads with a validation problem and stores nothing', function (): void {
    $merchant = ShopTestKit::merchant();
    $token = AuthTestKit::token($merchant);
    $long = str_repeat('<script>alert(1)</script>', 40);

    expect(mb_strlen($long))->toBeGreaterThanOrEqual(XssPayloads::LONG_LENGTH);

    $response = $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload(['name' => $long]));

    AuthTestKit::assertProblem($response, 422, 'validation.failed', [['field' => 'name', 'code' => 'max']]);
    expect((string) $response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and(Shop::query()->count())->toBe(0);

    $patched = $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->patchJson('/api/v1/me', ['name' => $long]);
    AuthTestKit::assertProblem($patched, 422, 'validation.failed', [['field' => 'name', 'code' => 'max']]);
});

it('never echoes a payload inside a problem response', function (string $payload): void {
    $token = AuthTestKit::token(ShopTestKit::merchant());

    // A payload in a field with a strict format is refused, and the refusal names the field and rule only.
    $response = $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload(['phone' => $payload, 'type' => $payload]));

    $response->assertStatus(422);

    $flat = (string) json_encode(json_decode((string) $response->getContent(), true, flags: JSON_THROW_ON_ERROR), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $needle = mb_substr(trim((string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), '"'), 0, 30);

    expect((string) $response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->json('errors'))->toBeArray()
        ->and($flat)->not->toContain($needle);
})->with(XssPayloads::all());
