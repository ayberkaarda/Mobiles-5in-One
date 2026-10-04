<?php

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

it('registers a pending shop owned by the merchant', function (): void {
    $merchant = ShopTestKit::merchant();
    $payload = ShopTestKit::payload();

    $response = $this->withToken(AuthTestKit::token($merchant))->postJson('/api/v1/shops', $payload);

    $response->assertCreated()
        ->assertJsonPath('data.slug', 'cinar-firini-kadikoy')
        ->assertJsonPath('data.verification_state', 'pending')
        ->assertJsonPath('data.verified_at', null)
        ->assertJsonPath('data.listed_on_web', true)
        ->assertJsonPath('data.phone', '+902165550102')
        ->assertJsonPath('data.location.lat', ShopTestKit::LAT)
        ->assertJsonPath('data.tax_number_masked', '******'.substr((string) $payload['tax_number'], -4))
        ->assertJsonPath('data.iban_masked', 'TR'.str_repeat('*', 20).substr((string) $payload['iban'], -4));

    $body = (string) $response->getContent();
    expect($body)
        ->not->toContain((string) $payload['tax_number'])
        ->not->toContain((string) $payload['iban'])
        ->not->toContain($merchant->id)
        ->not->toContain('owner_id')
        ->not->toContain('sub_merchant_key');

    $shop = Shop::query()->findOrFail($response->json('data.id'));
    expect($shop->owner_id)->toBe($merchant->id)
        ->and($shop->verification_state)->toBe(ShopVerificationState::Pending)
        ->and($shop->is_sample)->toBeFalse()
        ->and($shop->tax_number_enc)->toBe($payload['tax_number'])
        ->and($shop->iban_enc)->toBe($payload['iban']);

    $raw = DB::table('shops')->where('id', $shop->id)->first();
    expect((string) $raw?->tax_number_enc)->not->toContain((string) $payload['tax_number'])
        ->and((string) $raw?->iban_enc)->not->toContain((string) $payload['iban']);

    $member = ShopMember::query()->where('shop_id', $shop->id)->sole();
    expect($member->user_id)->toBe($merchant->id)->and($member->role)->toBe(ShopMemberRole::Owner);
});

it('makes slugs unique per name and district', function (): void {
    $token = AuthTestKit::token(ShopTestKit::merchant());

    $first = $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload())->assertCreated();
    AuthTestKit::forgetGuards();
    $second = $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload())->assertCreated();
    AuthTestKit::forgetGuards();
    $other = $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload(['name' => 'IŞIK Büfe', 'ilce' => 'Üsküdar']))->assertCreated();

    expect($first->json('data.slug'))->toBe('cinar-firini-kadikoy')
        ->and($second->json('data.slug'))->toBe('cinar-firini-kadikoy-2')
        ->and($other->json('data.slug'))->toBe('isik-bufe-uskudar');
});

it('refuses donors and merchants who are staff of another shop', function (): void {
    $donor = ShopTestKit::donor();
    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($donor))->postJson('/api/v1/shops', ShopTestKit::payload()),
        403,
        'forbidden',
    );

    AuthTestKit::forgetGuards();
    $staff = ShopTestKit::merchant();
    ShopTestKit::join(ShopTestKit::shop(), $staff, ShopMemberRole::Staff);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($staff))->postJson('/api/v1/shops', ShopTestKit::payload()),
        403,
        'forbidden',
    );

    expect(Shop::query()->where('name', 'Çınar Fırını')->exists())->toBeFalse();
});

it('requires a token', function (): void {
    AuthTestKit::assertProblem($this->postJson('/api/v1/shops', ShopTestKit::payload()), 401, 'auth.unauthenticated');
});

it('validates every field', function (string $field, mixed $value, string $code): void {
    $response = $this->withToken(AuthTestKit::token(ShopTestKit::merchant()))
        ->postJson('/api/v1/shops', ShopTestKit::payload([$field => $value]));

    AuthTestKit::assertProblem($response, 422, 'validation.failed', [['field' => $field, 'code' => $code]]);
})->with([
    'name missing' => ['name', '', 'required'],
    'name too long' => ['name', str_repeat('a', 121), 'max'],
    'type outside the list' => ['type', 'casino', 'enum'],
    'address too short' => ['address', 'abc', 'min'],
    'il missing' => ['il', '', 'required'],
    'ilce too long' => ['ilce', str_repeat('b', 65), 'max'],
    'latitude north of Türkiye' => ['lat', 43.5, 'between'],
    'longitude west of Türkiye' => ['lng', 20.0, 'between'],
    'latitude not a number' => ['lat', 'north', 'numeric'],
    'phone not Turkish' => ['phone', '+44 20 7946 0000', 'regex'],
    'tax number too short' => ['tax_number', '12345', 'digits'],
    'tax number not digits' => ['tax_number', 'ABCDEFGHIJ', 'digits'],
    'iban too short' => ['iban', 'TR'.str_repeat('0', 10), 'size'],
    'iban wrong country' => ['iban', 'DE'.str_repeat('1', 24), 'iban_checksum'],
    'listed_on_web missing' => ['listed_on_web', null, 'required'],
    'listed_on_web not boolean' => ['listed_on_web', 'maybe', 'boolean'],
]);

it('rejects a tax number with a wrong check digit and an IBAN with a wrong checksum', function (): void {
    $tax = ShopTestKit::taxNumber();
    $badTax = substr($tax, 0, 9).(((int) $tax[9] + 1) % 10);
    $iban = ShopTestKit::iban();
    $badIban = substr($iban, 0, 25).(((int) $iban[25] + 1) % 10);

    $token = AuthTestKit::token(ShopTestKit::merchant());

    AuthTestKit::assertProblem(
        $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload(['tax_number' => $badTax])),
        422,
        'validation.failed',
        [['field' => 'tax_number', 'code' => 'tax_number_checksum']],
    );

    AuthTestKit::forgetGuards();

    AuthTestKit::assertProblem(
        $this->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload(['iban' => $badIban])),
        422,
        'validation.failed',
        [['field' => 'iban', 'code' => 'iban_checksum']],
    );
});

it('accepts an IBAN written with spaces and lower case', function (): void {
    $iban = ShopTestKit::iban();
    $spaced = strtolower(implode(' ', str_split($iban, 4)));

    $response = $this->withToken(AuthTestKit::token(ShopTestKit::merchant()))
        ->postJson('/api/v1/shops', ShopTestKit::payload(['iban' => $spaced]))
        ->assertCreated();

    expect(Shop::query()->findOrFail($response->json('data.id'))->iban_enc)->toBe($iban);
});

it('never lets the client set server-controlled fields', function (string $field, mixed $value): void {
    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token(ShopTestKit::merchant()))->postJson('/api/v1/shops', ShopTestKit::payload([$field => $value])),
        422,
        'validation.failed',
        [['field' => $field, 'code' => 'prohibited']],
    );
})->with([
    ['verification_state', 'verified'],
    ['verified_at', '2026-10-01T00:00:00Z'],
    ['is_sample', true],
    ['owner_id', '0199a000-0000-7000-8000-000000000000'],
    ['slug', 'my-slug'],
    ['sub_merchant_key', 'key'],
]);
