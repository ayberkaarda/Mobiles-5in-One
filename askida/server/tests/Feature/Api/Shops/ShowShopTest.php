<?php

use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    config(['askida.allow_sample_shops' => false]);
});

it('shows a verified shop with its active items and available counts', function (): void {
    $shop = ShopTestKit::shop();
    $bread = ShopTestKit::item($shop, ['name' => 'Ekmek']);
    $soup = ShopTestKit::item($shop, ['name' => 'Mercimek çorbası', 'category' => 'corba', 'price_minor' => 6000]);
    ShopTestKit::item($shop, ['name' => 'Eski ürün', 'active' => false]);
    ShopTestKit::hooks($shop, $bread, 4);
    ShopTestKit::hooks($shop, $bread, 1, HookStatus::Reserved);
    ShopTestKit::hooks($shop, $soup, 1, HookStatus::Redeemed);

    $response = $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson("/api/v1/shops/{$shop->slug}");

    $response->assertOk()
        ->assertJsonPath('data.id', $shop->id)
        ->assertJsonPath('data.available_count', 4)
        ->assertJsonCount(2, 'data.items')
        ->assertJsonPath('data.items.0.id', $bread->id)
        ->assertJsonPath('data.items.0.available_count', 4)
        ->assertJsonPath('data.items.0.price_minor', 1500)
        ->assertJsonPath('data.items.1.id', $soup->id)
        ->assertJsonPath('data.items.1.category_label', 'Çorba')
        ->assertJsonPath('data.items.1.available_count', 0);

    expect(array_keys($response->json('data.items.0')))->toBe(['id', 'name', 'category', 'category_label', 'price_minor', 'currency', 'available_count'])
        ->and((string) $response->getContent())
        ->not->toContain((string) $shop->tax_number_enc)
        ->not->toContain((string) $shop->iban_enc)
        ->not->toContain($shop->phone)
        ->not->toContain((string) $shop->owner_id)
        ->not->toContain('daily_cap');
});

it('answers 404 for unverified shops to non-members and for unknown slugs', function (ShopVerificationState $state): void {
    $shop = ShopTestKit::shop(state: $state);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson("/api/v1/shops/{$shop->slug}"),
        404,
        'not_found',
    );

    AuthTestKit::forgetGuards();

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token(ShopTestKit::merchant()))->getJson("/api/v1/shops/{$shop->slug}"),
        404,
        'not_found',
    );
})->with([ShopVerificationState::Pending, ShopVerificationState::Rejected]);

it('answers 404 for an unknown slug', function (): void {
    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson('/api/v1/shops/no-such-shop'),
        404,
        'not_found',
    );
});

it('shows an unverified shop to its members, the owner view with masked financial data', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner, ShopVerificationState::Pending);
    $staff = ShopTestKit::merchant();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);

    $ownerView = $this->withToken(AuthTestKit::token($owner))->getJson("/api/v1/shops/{$shop->slug}")->assertOk()
        ->assertJsonPath('data.verification_state', 'pending')
        ->assertJsonPath('data.tax_number_masked', '******'.substr((string) $shop->tax_number_enc, -4));
    expect((string) $ownerView->getContent())->not->toContain((string) $shop->tax_number_enc)->not->toContain((string) $shop->iban_enc);

    AuthTestKit::forgetGuards();

    $staffView = $this->withToken(AuthTestKit::token($staff))->getJson("/api/v1/shops/{$shop->slug}")->assertOk();
    expect($staffView->json('data'))->not->toHaveKey('tax_number_masked')->not->toHaveKey('phone');
});

it('hides sample shops unless they are allowed', function (): void {
    $shop = ShopTestKit::shop(attributes: ['is_sample' => true]);
    $token = AuthTestKit::token(ShopTestKit::donor());

    $this->withToken($token)->getJson("/api/v1/shops/{$shop->slug}")->assertNotFound();

    config(['askida.allow_sample_shops' => true]);
    $this->withToken($token)->getJson("/api/v1/shops/{$shop->slug}")->assertOk()->assertJsonPath('data.is_sample', true);
});

it('requires a token', function (): void {
    $shop = ShopTestKit::shop();

    AuthTestKit::assertProblem($this->getJson("/api/v1/shops/{$shop->slug}"), 401, 'auth.unauthenticated');
});
