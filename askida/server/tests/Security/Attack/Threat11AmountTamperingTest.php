<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;

/*
| Threat 4.11, payment amount tampering. The donation body is exactly shop_id, item_id and
| qty: any money field (in the body or the query string) is refused as `prohibited`; the
| server computes the amount from the item price, applies the per-transaction and per-day
| caps, opens the checkout with its own figures, and a provider amount that differs from
| the stored one is a mismatch, never a payment.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->gateway = PaymentWorld::useFakeGateway();
    Mail::fake();
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
    $this->shop = PaymentWorld::payableShop();
    $this->item = PaymentWorld::item($this->shop, 1_500);
    $this->donor = PaymentWorld::donor();
});

/**
 * @param  array<string, mixed>  $extra
 */
function attack11Donate(User $donor, string $shopId, string $itemId, mixed $qty, array $extra = [], string $query = ''): TestResponse
{
    return AttackKit::json('POST', '/api/v1/donations'.$query, PaymentWorld::token($donor), ['shop_id' => $shopId, 'item_id' => $itemId, 'qty' => $qty] + $extra);
}

it('refuses every client money field as prohibited and records nothing', function (array $extra, array $expected): void {
    $response = attack11Donate($this->donor, $this->shop->id, $this->item->id, 2, $extra);

    AttackKit::assertProblem($response, 422, 'validation.failed');
    expect(AttackKit::errorPairs($response))->toBe($expected)
        ->and(Donation::query()->count())->toBe(0);
})->with([
    'amount' => [['amount' => 1], ['amount:prohibited']],
    'amount_minor' => [['amount_minor' => 1], ['amount_minor:prohibited']],
    'null amount_minor' => [['amount_minor' => null], ['amount_minor:prohibited']],
    'price and currency' => [['price_minor' => 1, 'currency' => 'USD'], ['currency:prohibited', 'price_minor:prohibited']],
    'commission and status' => [['commission_minor' => 0, 'status' => 'paid'], ['commission_minor:prohibited', 'status:prohibited']],
    'donor id' => [['donor_id' => '00000000-0000-7000-8000-000000000000'], ['donor_id:prohibited']],
    'dotted key' => [['amount.minor' => 1], ['_body:prohibited']],
]);

it('refuses a money field smuggled in the query string', function (): void {
    $response = attack11Donate($this->donor, $this->shop->id, $this->item->id, 2, query: '?amount_minor=1');

    AttackKit::assertProblem($response, 422, 'validation.failed');
    expect(AttackKit::errorPairs($response))->toBe(['amount_minor:prohibited'])
        ->and(Donation::query()->count())->toBe(0);
});

it('refuses quantities that are not whole numbers between 1 and 20', function (mixed $qty, string $rule): void {
    $response = attack11Donate($this->donor, $this->shop->id, $this->item->id, $qty);

    AttackKit::assertProblem($response, 422, 'validation.failed');
    expect(AttackKit::errorPairs($response))->toBe(['qty:'.$rule])
        ->and(Donation::query()->count())->toBe(0);
})->with([
    'zero' => [0, 'min'],
    'negative' => [-3, 'min'],
    'above the bound' => [21, 'max'],
    'fraction' => [1.5, 'integer'],
    'numeric string with suffix' => ['2abc', 'integer'],
    'huge' => [PHP_INT_MAX, 'max'],
    'array' => [[1], 'integer'],
]);

it('computes the amount on the server and opens the checkout with its own figures', function (): void {
    $response = attack11Donate($this->donor, $this->shop->id, $this->item->id, 3)->assertCreated();

    $donation = Donation::query()->findOrFail($response->json('donation_id'));
    $checkout = $this->gateway->checkoutFor((string) $donation->provider_token);

    expect($donation->amount_minor)->toBe(4_500)
        ->and($donation->currency)->toBe('TRY')
        ->and($donation->status)->toBe(DonationStatus::Initiated)
        ->and($checkout['amount'] ?? null)->toBe(4_500)
        ->and($checkout['unit'] ?? null)->toBe(1_500)
        ->and($checkout['qty'] ?? null)->toBe(3)
        ->and($checkout['commission'] ?? null)->toBe($donation->commission_minor)
        ->and($checkout['buyer'] ?? null)->toBe($this->donor->id);
});

it('applies the per-transaction cap to the computed amount', function (): void {
    $expensive = PaymentWorld::item($this->shop, (int) config('payments.caps.transaction_minor'));

    AttackKit::assertProblem(attack11Donate($this->donor, $this->shop->id, $expensive->id, 2), 422, 'donation.tx_cap_exceeded');
    expect(Donation::query()->count())->toBe(0);

    // Negative control: one unit at exactly the cap is accepted.
    attack11Donate($this->donor, $this->shop->id, $expensive->id, 1)->assertCreated();
});

it('applies the donor day cap across donations', function (): void {
    $cap = (int) config('payments.caps.donor_day_minor');
    $big = PaymentWorld::item($this->shop, (int) config('payments.caps.transaction_minor'));
    $paid = HookWorld::donation($big, $this->donor, qty: 1);
    DB::table('donations')->where('id', $paid->id)->update(['amount_minor' => $cap - 1_000]);

    AttackKit::assertProblem(attack11Donate($this->donor, $this->shop->id, $this->item->id, 1), 409, 'donation.cap_exceeded');
    expect(Donation::query()->where('status', DonationStatus::Initiated->value)->count())->toBe(0);

    // Negative control: another donor is not affected.
    attack11Donate(PaymentWorld::donor(), $this->shop->id, $this->item->id, 1)->assertCreated();
});

it('treats a provider amount below the stored amount as a mismatch, not a payment', function (): void {
    $response = attack11Donate($this->donor, $this->shop->id, $this->item->id, 2)->assertCreated();
    $donation = Donation::query()->findOrFail($response->json('donation_id'));
    $token = (string) $donation->provider_token;

    $this->gateway->scriptPayment($token, ProviderPaymentStatus::Success, $donation->amount_minor - 1, 'TRY', $donation->conversation_id);
    expect(app(SettlesPayments::class)->settle($token))->toBe(SettlementOutcome::Mismatch)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(0)
        ->and(DB::table('payment_mismatches')->where('donation_id', $donation->id)->pluck('kind')->all())->toBe(['amount_mismatch']);

    // A price change after checkout does not move the stored amount; the provider's figure matches it.
    $this->item->forceFill(['price_minor' => 100])->save();
    $this->gateway->scriptPayment($token, ProviderPaymentStatus::Success, 3_000, 'TRY', $donation->conversation_id);
    expect(app(SettlesPayments::class)->settle($token))->toBe(SettlementOutcome::Paid)
        ->and($donation->fresh()?->amount_minor)->toBe(3_000)
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(2);
});

it('treats another currency as a mismatch', function (): void {
    $donation = PaymentWorld::initiated($this->item, $this->donor);
    $this->gateway->scriptPayment((string) $donation->provider_token, ProviderPaymentStatus::Success, $donation->amount_minor, 'USD', $donation->conversation_id);

    expect(app(SettlesPayments::class)->settle((string) $donation->provider_token))->toBe(SettlementOutcome::Mismatch)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Initiated)
        ->and(FakeGateway::tokenFor((string) $donation->conversation_id))->toBe($donation->provider_token);
});
