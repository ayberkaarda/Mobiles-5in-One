<?php

use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| GET me/shops (matrix 3.1): the shops a merchant owns or staffs, with its role, read
| from shop_members on every request. Donors 403, anon devices and guests 401.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    config(['askida.allow_sample_shops' => false]);
});

it('lists the shops the merchant owns and staffs with its role, and nothing else', function (): void {
    $merchant = ShopTestKit::merchant();
    $owned = ShopTestKit::shop($merchant, attributes: ['name' => 'Ada Fırını', 'slug' => 'ada-firini']);
    $pending = ShopTestKit::shop($merchant, ShopVerificationState::Pending, ['name' => 'Bostan Lokantası', 'slug' => 'bostan-lokantasi', 'type' => 'restaurant']);
    $staffed = ShopTestKit::shop(null, attributes: ['name' => 'Cevizli Büfe', 'slug' => 'cevizli-bufe']);
    ShopTestKit::join($staffed, $merchant, ShopMemberRole::Staff);
    ShopTestKit::shop();

    $response = $this->withToken(AuthTestKit::token($merchant))->getJson('/api/v1/me/shops')->assertOk();

    expect($response->json('data'))->toBe([
        ['id' => $owned->id, 'slug' => 'ada-firini', 'name' => 'Ada Fırını', 'type' => 'bakery', 'type_label' => 'Fırın', 'il' => 'İstanbul', 'ilce' => 'Kadıköy', 'verification_state' => 'verified', 'role' => 'owner'],
        ['id' => $pending->id, 'slug' => 'bostan-lokantasi', 'name' => 'Bostan Lokantası', 'type' => 'restaurant', 'type_label' => 'Lokanta', 'il' => 'İstanbul', 'ilce' => 'Kadıköy', 'verification_state' => 'pending', 'role' => 'owner'],
        ['id' => $staffed->id, 'slug' => 'cevizli-bufe', 'name' => 'Cevizli Büfe', 'type' => 'bakery', 'type_label' => 'Fırın', 'il' => 'İstanbul', 'ilce' => 'Kadıköy', 'verification_state' => 'verified', 'role' => 'staff'],
    ]);

    $body = (string) $response->getContent();
    expect($body)->not->toContain('phone')->not->toContain('tax_number')->not->toContain('iban')
        ->not->toContain('owner_id')->not->toContain($merchant->id)->not->toContain($merchant->email);
});

it('answers an empty list for a merchant without shops', function (): void {
    ShopTestKit::shop();

    $this->withToken(AuthTestKit::token(ShopTestKit::merchant()))->getJson('/api/v1/me/shops')
        ->assertOk()
        ->assertExactJson(['data' => []]);
});

it('reads membership on every request: a removed staff member no longer sees the shop', function (): void {
    $staff = ShopTestKit::merchant();
    $shop = ShopTestKit::shop();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);
    $token = AuthTestKit::token($staff);

    $this->withToken($token)->getJson('/api/v1/me/shops')->assertOk()->assertJsonPath('data.0.id', $shop->id);

    ShopMember::query()->where('shop_id', $shop->id)->where('user_id', $staff->id)->delete();
    AuthTestKit::forgetGuards();

    $this->withToken($token)->getJson('/api/v1/me/shops')->assertOk()->assertExactJson(['data' => []]);
});

it('hides sample shops unless samples are allowed, like the directory', function (): void {
    $merchant = ShopTestKit::merchant();
    $sample = ShopTestKit::shop($merchant, attributes: ['is_sample' => true]);
    $token = AuthTestKit::token($merchant);

    $this->withToken($token)->getJson('/api/v1/me/shops')->assertOk()->assertExactJson(['data' => []]);

    config(['askida.allow_sample_shops' => true]);
    AuthTestKit::forgetGuards();
    $this->withToken($token)->getJson('/api/v1/me/shops')->assertOk()->assertJsonPath('data.0.id', $sample->id);
});

it('refuses donors with 403 and anon devices and guests with 401', function (): void {
    HookWorld::pepper();
    ShopTestKit::shop();

    AuthTestKit::assertProblem($this->withToken(AuthTestKit::token(ShopTestKit::donor()))->getJson('/api/v1/me/shops'), 403, 'forbidden');

    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($this->withToken(HookWorld::anonToken(HookWorld::anon()))->getJson('/api/v1/me/shops'), 401, 'auth.unauthenticated');

    AuthTestKit::forgetGuards();
    AuthTestKit::assertProblem($this->withHeaders(['Authorization' => ''])->getJson('/api/v1/me/shops'), 401, 'auth.unauthenticated');
});
