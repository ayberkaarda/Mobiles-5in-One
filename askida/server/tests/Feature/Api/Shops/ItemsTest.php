<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\ShopMemberRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

/**
 * @return array<string, mixed>
 */
function itemPayload(array $overrides = []): array
{
    return array_merge(['name' => 'Simit', 'category' => 'ekmek', 'price_minor' => 1000, 'daily_cap' => 10], $overrides);
}

it('lets the owner add an item', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    $response = $this->withToken(AuthTestKit::token($owner))->postJson("/api/v1/shops/{$shop->id}/items", itemPayload())
        ->assertCreated()
        ->assertJsonPath('data.shop_id', $shop->id)
        ->assertJsonPath('data.name', 'Simit')
        ->assertJsonPath('data.category', 'ekmek')
        ->assertJsonPath('data.category_label', 'Ekmek')
        ->assertJsonPath('data.price_minor', 1000)
        ->assertJsonPath('data.currency', 'TRY')
        ->assertJsonPath('data.daily_cap', 10)
        ->assertJsonPath('data.active', true);

    $item = Item::query()->findOrFail($response->json('data.id'));
    expect($item->shop_id)->toBe($shop->id)->and($item->category)->toBe(ItemCategory::Ekmek);
});

it('lets the owner edit an item, and a price change leaves existing donations and hooks untouched', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $item = ShopTestKit::item($shop, ['price_minor' => 1500]);
    $donation = ShopTestKit::hooks($shop, $item, 3);
    $hooksBefore = Hook::query()->where('item_id', $item->id)->orderBy('id')->get()->map->getAttributes()->all();

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}/items/{$item->id}", ['price_minor' => 2500, 'active' => false, 'daily_cap' => 5])
        ->assertOk()
        ->assertJsonPath('data.price_minor', 2500)
        ->assertJsonPath('data.active', false)
        ->assertJsonPath('data.daily_cap', 5);

    expect(Donation::query()->findOrFail($donation->id)->amount_minor)->toBe(4500)
        ->and(Hook::query()->where('item_id', $item->id)->orderBy('id')->get()->map->getAttributes()->all())->toBe($hooksBefore);
});

it('keeps writes owner-only: staff 403, other merchants 404, donors 403', function (string $method): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $item = ShopTestKit::item($shop);
    $staff = ShopTestKit::merchant();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);
    $stranger = ShopTestKit::merchant();
    ShopTestKit::shop($stranger);

    $call = fn (string $token) => $method === 'post'
        ? $this->withToken($token)->postJson("/api/v1/shops/{$shop->id}/items", itemPayload())
        : $this->withToken($token)->patchJson("/api/v1/shops/{$shop->id}/items/{$item->id}", ['price_minor' => 100]);

    AuthTestKit::assertProblem($call(AuthTestKit::token($staff)), 403, 'forbidden');
    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($call(AuthTestKit::token($stranger)), 404, 'not_found');
    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($call(AuthTestKit::token(ShopTestKit::donor())), 403, 'forbidden');

    expect(Item::query()->where('shop_id', $shop->id)->count())->toBe(1)
        ->and(Item::query()->findOrFail($item->id)->price_minor)->toBe($item->price_minor);
})->with(['post', 'patch']);

it('answers 404 for an item of another shop, even to an owner of both', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $otherShop = ShopTestKit::shop($owner);
    $foreignItem = ShopTestKit::item($otherShop);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($owner))->patchJson("/api/v1/shops/{$shop->id}/items/{$foreignItem->id}", ['price_minor' => 100]),
        404,
        'not_found',
    );

    expect(Item::query()->findOrFail($foreignItem->id)->price_minor)->toBe(1500);
});

it('lets owner and staff read the full catalog, nobody else', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    ShopTestKit::item($shop, ['name' => 'A ürün']);
    ShopTestKit::item($shop, ['name' => 'B ürün', 'active' => false]);
    $staff = ShopTestKit::merchant();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);

    foreach ([$owner, $staff] as $member) {
        AuthTestKit::forgetGuards();
        $this->withToken(AuthTestKit::token($member))->getJson("/api/v1/shops/{$shop->id}/items")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'A ürün')
            ->assertJsonPath('data.1.active', false);
    }

    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($this->withToken(AuthTestKit::token(ShopTestKit::merchant()))->getJson("/api/v1/shops/{$shop->id}/items"), 404, 'not_found');
    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson("/api/v1/shops/{$shop->id}/items"), 403, 'forbidden');
    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($this->withoutToken()->getJson("/api/v1/shops/{$shop->id}/items"), 401, 'auth.unauthenticated');
});

it('validates item fields', function (string $field, mixed $value, string $code): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($owner))->postJson("/api/v1/shops/{$shop->id}/items", itemPayload([$field => $value])),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );
})->with([
    'price below 1 TRY' => ['price_minor', 99, 'min'],
    'price above 10 000 TRY' => ['price_minor', 1_000_001, 'max'],
    'price with decimals' => ['price_minor', 10.5, 'integer'],
    'daily cap zero' => ['daily_cap', 0, 'min'],
    'category outside the list' => ['category', 'pizza', 'enum'],
    'name missing' => ['name', '', 'required'],
    'currency is server-controlled' => ['currency', 'USD', 'prohibited'],
    'shop is server-controlled' => ['shop_id', '0199a000-0000-7000-8000-000000000000', 'prohibited'],
    'active not boolean' => ['active', 'sometimes', 'boolean'],
]);

it('accepts the price bounds', function (int $price): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    $this->withToken(AuthTestKit::token($owner))
        ->postJson("/api/v1/shops/{$shop->id}/items", itemPayload(['price_minor' => $price]))
        ->assertCreated()
        ->assertJsonPath('data.price_minor', $price);
})->with([100, 1_000_000]);
