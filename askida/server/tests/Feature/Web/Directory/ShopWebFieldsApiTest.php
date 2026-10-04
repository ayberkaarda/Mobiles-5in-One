<?php

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;

uses(RefreshDatabase::class);

/*
| The two web directory fields of PATCH shops/{id}: `opening_hours` and `listed_on_web`
| (owner only), and the province/district slugs the model keeps in sync.
*/

beforeEach(fn () => AuthTestKit::boot());

it('lets the owner set opening hours, stored and returned as a full week', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    $response = $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['opening_hours' => [
            'sat' => ['open' => '09:00', 'close' => '18:00'],
            'mon' => ['close' => '20:00', 'open' => '08:00'],
            'fri' => ['open' => '18:00', 'close' => '02:00'],
        ]])
        ->assertOk()
        ->assertJsonPath('data.verification_state', 'verified');

    $expected = [
        'mon' => ['open' => '08:00', 'close' => '20:00'],
        'tue' => null,
        'wed' => null,
        'thu' => null,
        'fri' => ['open' => '18:00', 'close' => '02:00'],
        'sat' => ['open' => '09:00', 'close' => '18:00'],
        'sun' => null,
    ];

    expect($response->json('data.opening_hours'))->toBe($expected)
        ->and(Shop::query()->findOrFail($shop->id)->opening_hours)->toEqual($expected);

    // Opening hours are not a verification-relevant field.
    expect(Activity::query()->where('event', 'shop.sensitive_change')->exists())->toBeFalse();
});

it('clears the opening hours with null and shows them on the public detail', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner, attributes: ['opening_hours' => DirectoryWorld::HOURS]);
    $token = AuthTestKit::token($owner);

    $this->withToken(AuthTestKit::token(ShopTestKit::donor()))
        ->getJson("/api/v1/shops/{$shop->slug}")
        ->assertOk()
        ->assertJsonPath('data.opening_hours.mon', ['open' => '08:00', 'close' => '20:00'])
        ->assertJsonPath('data.opening_hours.sun', null);

    AuthTestKit::forgetGuards();

    $this->withToken($token)
        ->patchJson("/api/v1/shops/{$shop->id}", ['opening_hours' => null])
        ->assertOk()
        ->assertJsonPath('data.opening_hours', null);

    expect(Shop::query()->findOrFail($shop->id)->opening_hours)->toBeNull();
});

it('refuses malformed opening hours with a code only', function (mixed $hours): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($owner))->patchJson("/api/v1/shops/{$shop->id}", ['opening_hours' => $hours]),
        422,
        'validation.failed',
        [['field' => 'opening_hours', 'code' => is_array($hours) ? 'opening_hours_format' : 'array']],
    );

    expect(Shop::query()->findOrFail($shop->id)->opening_hours)->toBeNull();
})->with([
    'not an object' => ['08:00-20:00'],
    'unknown day' => [['monday' => ['open' => '08:00', 'close' => '20:00']]],
    'list instead of object' => [[['open' => '08:00', 'close' => '20:00']]],
    'missing close' => [['mon' => ['open' => '08:00']]],
    'extra key' => [['mon' => ['open' => '08:00', 'close' => '20:00', 'note' => 'x']]],
    'bad time' => [['mon' => ['open' => '8:00', 'close' => '20:00']]],
    'hour 24' => [['mon' => ['open' => '08:00', 'close' => '24:00']]],
    'same time' => [['mon' => ['open' => '08:00', 'close' => '08:00']]],
    'day not an object' => [['mon' => 'closed']],
]);

it('lets only the owner change the web listing and the hours', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $staff = ShopTestKit::merchant();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($staff))->patchJson("/api/v1/shops/{$shop->id}", ['listed_on_web' => false, 'opening_hours' => DirectoryWorld::HOURS]),
        403,
        'forbidden',
    );

    $fresh = Shop::query()->findOrFail($shop->id);
    expect($fresh->listed_on_web)->toBeTrue()->and($fresh->opening_hours)->toBeNull();
});

it('keeps the province and district slugs in sync with the names', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner, ShopVerificationState::Pending, ['il' => 'İzmir', 'ilce' => 'Karşıyaka']);

    expect([$shop->il_slug, $shop->ilce_slug])->toBe(['izmir', 'karsiyaka']);

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['il' => 'Muğla', 'ilce' => 'Ölüdeniz Çığlık'])
        ->assertOk();

    $row = DB::table('shops')->where('id', $shop->id)->first(['il_slug', 'ilce_slug']);
    expect([$row->il_slug, $row->ilce_slug])->toBe(['mugla', 'oludeniz-ciglik']);
});
