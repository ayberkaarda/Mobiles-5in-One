<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Shops\Models\ShopVerificationState;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| POST/GET donations: server-side amounts, caps, payable shops, own data only
| (story 4, security items 3, 22, 23).
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
    $this->fake = PaymentWorld::useFakeGateway();
    $this->shop = PaymentWorld::payableShop();
    $this->item = PaymentWorld::item($this->shop, 1_500);
    $this->donor = PaymentWorld::donor();
    $this->token = PaymentWorld::token($this->donor);
});

function donate(object $test, array $body, ?string $token = null): Illuminate\Testing\TestResponse
{
    return $test->withToken($token ?? $test->token)->postJson('/api/v1/donations', $body);
}

function pastDonation(object $test, int $amount, DonationStatus $status, CarbonImmutable $createdAt): Donation
{
    $donation = HookWorld::donation($test->item, $test->donor, 1, paid: false);
    $donation->forceFill([
        'amount_minor' => $amount,
        'status' => $status,
        'paid_at' => $status === DonationStatus::Paid ? $createdAt : null,
        'created_at' => $createdAt,
    ])->save();

    return $donation;
}

it('creates an initiated donation with server amounts and returns the pay page url', function (): void {
    $response = donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 3]);

    $response->assertCreated()->assertExactJsonStructure(['donation_id', 'checkout_url']);
    $donation = Donation::query()->findOrFail($response->json('donation_id'));
    $checkout = $this->fake->checkoutFor((string) $donation->provider_token);

    expect($donation->status)->toBe(DonationStatus::Initiated)
        ->and($donation->donor_id)->toBe($this->donor->id)
        ->and($donation->amount_minor)->toBe(4_500)
        ->and($donation->commission_minor)->toBe(225)
        ->and($donation->conversation_id)->not->toBeNull()
        ->and($response->json('checkout_url'))->toBe('https://askida.test/pay/'.$donation->provider_token)
        ->and($checkout['amount'])->toBe(4_500)
        ->and($checkout['commission'])->toBe(225)
        ->and($checkout['sub_merchant'])->toBe($this->shop->sub_merchant_key)
        ->and($checkout['conversation'])->toBe($donation->conversation_id)
        ->and($checkout['buyer'])->toBe($this->donor->id);
});

it('refuses any amount or other field from the client and creates nothing', function (string $field, mixed $value): void {
    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1, $field => $value])
        ->assertStatus(422)
        ->assertJsonPath('code', 'validation.failed')
        ->assertJsonFragment(['field' => $field, 'code' => 'prohibited']);

    expect(Donation::query()->count())->toBe(0);
})->with([
    ['amount_minor', 1],
    ['amount', 1],
    ['price_minor', 1],
    ['commission_minor', 0],
    ['currency', 'USD'],
    ['status', 'paid'],
    ['donor_id', 'someone'],
    ['provider_token', 'x'],
]);

it('refuses keys the validator would read as paths', function (): void {
    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1, 'amount.minor' => 1])
        ->assertStatus(422)
        ->assertJsonFragment(['field' => '_body', 'code' => 'prohibited']);
});

it('validates the three fields', function (array $body, string $field): void {
    donate($this, array_merge(['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1], $body))
        ->assertStatus(422)
        ->assertJsonPath('errors.0.field', $field);
})->with([
    'qty zero' => [['qty' => 0], 'qty'],
    'qty over 20' => [['qty' => 21], 'qty'],
    'qty text' => [['qty' => 'two'], 'qty'],
    'shop not a uuid' => [['shop_id' => '12'], 'shop_id'],
    'no item' => [['item_id' => null], 'item_id'],
]);

it('lets only donor tokens donate', function (): void {
    $merchantToken = PaymentWorld::token(HookWorld::merchant());

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1], $merchantToken)
        ->assertForbidden()->assertJsonPath('code', 'forbidden');
    app('auth')->forgetGuards();
    $this->withoutToken()->postJson('/api/v1/donations', [])->assertUnauthorized();
    app('auth')->forgetGuards();
    $this->withToken(HookWorld::anonToken(HookWorld::anon()))->postJson('/api/v1/donations', [])->assertUnauthorized();
});

it('refuses shops that cannot be paid', function (Closure $prepare): void {
    $prepare($this->shop);

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1])
        ->assertStatus(409)->assertJsonPath('code', 'shop.not_payable');
    expect(Donation::query()->count())->toBe(0);
})->with([
    'pending verification' => [fn ($shop) => $shop->forceFill(['verification_state' => ShopVerificationState::Pending, 'verified_at' => null])->save()],
    'rejected' => [fn ($shop) => $shop->forceFill(['verification_state' => ShopVerificationState::Rejected, 'verified_at' => null])->save()],
    'no sub-merchant key' => [fn ($shop) => $shop->forceFill(['sub_merchant_key' => null])->save()],
]);

it('answers 404 for an unknown shop, an inactive item or an item of another shop', function (Closure $body): void {
    donate($this, $body($this))->assertNotFound()->assertJsonPath('code', 'not_found');
})->with([
    'unknown shop' => [fn ($t) => ['shop_id' => (string) Str::uuid7(), 'item_id' => $t->item->id, 'qty' => 1]],
    'inactive item' => [fn ($t) => ['shop_id' => $t->shop->id, 'item_id' => PaymentWorld::item($t->shop, active: false)->id, 'qty' => 1]],
    'foreign item' => [fn ($t) => ['shop_id' => $t->shop->id, 'item_id' => PaymentWorld::item(PaymentWorld::payableShop())->id, 'qty' => 1]],
]);

it('caps one donation at TRY 2000', function (): void {
    $item = PaymentWorld::item($this->shop, 10_000);

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $item->id, 'qty' => 20])->assertCreated();
    donate($this, ['shop_id' => $this->shop->id, 'item_id' => PaymentWorld::item($this->shop, 10_001)->id, 'qty' => 20])
        ->assertStatus(422)->assertJsonPath('code', 'donation.tx_cap_exceeded');
});

it('caps a donor at TRY 5000 per Istanbul day, counting paid and recent initiated donations', function (): void {
    $now = CarbonImmutable::now();
    pastDonation($this, 300_000, DonationStatus::Paid, $now->subHours(3));
    pastDonation($this, 150_000, DonationStatus::Initiated, $now->subMinutes(10));
    $item = PaymentWorld::item($this->shop, 5_001);

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $item->id, 'qty' => 10])
        ->assertStatus(409)->assertJsonPath('code', 'donation.cap_exceeded');
    donate($this, ['shop_id' => $this->shop->id, 'item_id' => PaymentWorld::item($this->shop, 5_000)->id, 'qty' => 10])
        ->assertCreated();
});

it('does not count failed, stale initiated, other days or other donors towards the day cap', function (): void {
    $now = CarbonImmutable::now();
    pastDonation($this, 400_000, DonationStatus::Failed, $now->subHour());
    pastDonation($this, 400_000, DonationStatus::Initiated, $now->subMinutes(31));
    pastDonation($this, 400_000, DonationStatus::Paid, $now->setTimezone('Europe/Istanbul')->startOfDay()->subMinute());
    HookWorld::donation($this->item, null, 1)->forceFill(['amount_minor' => 400_000])->save();
    $item = PaymentWorld::item($this->shop, 10_000);

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $item->id, 'qty' => 20])->assertCreated();
    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $item->id, 'qty' => 20])->assertCreated();
    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $item->id, 'qty' => 11])
        ->assertStatus(409)->assertJsonPath('code', 'donation.cap_exceeded');
});

it('marks the donation failed and answers 503 when the provider is down', function (): void {
    $this->fake->scriptUnavailable();

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1])
        ->assertStatus(503)->assertJsonPath('code', 'service_unavailable');
    expect(Donation::query()->sole()->status)->toBe(DonationStatus::Failed);
});

it('limits donation starts to 20 per hour per donor', function (): void {
    foreach (range(1, 20) as $attempt) {
        donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1])->assertCreated();
    }

    donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1])
        ->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
});

it('lists only the caller\'s donations, newest first, with a cursor and no provider data', function (): void {
    $own = [];
    foreach (range(1, 3) as $i) {
        $this->travel(1)->minutes();
        $own[] = donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => $i])->json('donation_id');
    }
    HookWorld::donation($this->item, null, 1);

    $first = $this->withToken($this->token)->getJson('/api/v1/donations?limit=2')->assertOk();
    $second = $this->withToken($this->token)->getJson('/api/v1/donations?limit=2&cursor='.urlencode((string) $first->json('meta.next_cursor')))->assertOk();

    expect(array_column($first->json('data'), 'id'))->toBe([$own[2], $own[1]])
        ->and(array_column($second->json('data'), 'id'))->toBe([$own[0]])
        ->and($second->json('meta.next_cursor'))->toBeNull()
        ->and(array_keys($first->json('data.0')))->toBe(['id', 'shop', 'item', 'qty', 'amount_minor', 'commission_minor', 'net_minor', 'currency', 'status', 'paid_at', 'created_at'])
        ->and($first->getContent())->not->toContain((string) Donation::query()->findOrFail($own[2])->provider_token);
});

it('shows an own donation and hides everyone else\'s as missing', function (): void {
    $own = donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 2])->json('donation_id');
    $other = HookWorld::donation($this->item, null, 1);

    $this->withToken($this->token)->getJson('/api/v1/donations/'.$own)
        ->assertOk()->assertJsonPath('data.id', $own)->assertJsonPath('data.amount_minor', 3_000)
        ->assertJsonPath('data.net_minor', 2_850)->assertJsonPath('data.item.name', 'Ekmek');
    $this->withToken($this->token)->getJson('/api/v1/donations/'.$other->id)->assertNotFound()->assertJsonPath('code', 'not_found');
    $this->withToken($this->token)->getJson('/api/v1/donations/'.Str::uuid7())->assertNotFound();
    app('auth')->forgetGuards();
    $this->withToken(PaymentWorld::token(HookWorld::merchant()))->getJson('/api/v1/donations/'.$own)->assertForbidden();
});

it('derives the same token as the fake provider', function (): void {
    $id = donate($this, ['shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 1])->json('donation_id');
    $donation = Donation::query()->findOrFail($id);

    expect($donation->provider_token)->toBe(FakeGateway::tokenFor((string) $donation->conversation_id));
});
