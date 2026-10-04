<?php

use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\SettlementRecord;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use Illuminate\Support\Str;

/*
| The deterministic local gateway used by tests and development.
*/

function fakeCheckout(FakeGateway $gateway, string $conversation, int $amount = 3_000): string
{
    return $gateway->initializeCheckout(new CheckoutRequest(
        (string) Str::uuid7(), $conversation, 'sm-1', 'item-1', 'Ekmek', intdiv($amount, 1_500), 1_500, $amount, 150, 'TRY',
        'https://askida.test/pay/callback', 'donor-1',
    ))->providerToken;
}

it('derives the token from the conversation id and renders a token-only form to the callback', function (): void {
    $gateway = app(FakeGateway::class);
    $session = $gateway->initializeCheckout(new CheckoutRequest(
        (string) Str::uuid7(), 'conv-a', 'sm-1', 'item-1', 'Ekmek', 2, 1_500, 3_000, 150, 'TRY', 'https://askida.test/pay/callback', 'donor-1',
    ));

    expect($session->providerToken)->toBe(FakeGateway::tokenFor('conv-a'))
        ->and(fakeCheckout($gateway, 'conv-a'))->toBe($session->providerToken)
        ->and($session->paymentPageHtml)->toContain('action="/pay/callback"')
        ->toContain('name="token" value="'.$session->providerToken.'"')
        ->not->toContain('name="status"')
        ->and(substr_count($session->paymentPageHtml, '<input'))->toBe(1);
});

it('answers success with the checkout values by default and failure for unknown tokens', function (): void {
    $gateway = app(FakeGateway::class);
    $token = fakeCheckout($gateway, 'conv-b');

    $paid = $gateway->retrievePayment($token);
    $unknown = $gateway->retrievePayment('fake-unknown-token');

    expect($paid->status)->toBe(ProviderPaymentStatus::Success)
        ->and($paid->paidAmountMinor)->toBe(3_000)
        ->and($paid->conversationId)->toBe('conv-b')
        ->and($paid->items[0]->subMerchantPayoutMinor)->toBe(2_850)
        ->and($unknown->status)->toBe(ProviderPaymentStatus::Failure)
        ->and($unknown->paidAmountMinor)->toBe(0);
});

it('answers what a test scripted, per token', function (): void {
    $gateway = app(FakeGateway::class);
    $token = fakeCheckout($gateway, 'conv-c');

    $gateway->scriptPayment($token, ProviderPaymentStatus::Success, paidAmountMinor: 1);
    expect($gateway->retrievePayment($token)->paidAmountMinor)->toBe(1);

    $gateway->scriptPayment($token, ProviderPaymentStatus::Pending);
    expect($gateway->retrievePayment($token)->status)->toBe(ProviderPaymentStatus::Pending);

    $gateway->scriptUnavailable($token);
    expect(fn () => $gateway->retrievePayment($token))->toThrow(GatewayUnavailable::class);

    $gateway->scriptUnavailable();
    expect(fn () => fakeCheckout($gateway, 'conv-d'))->toThrow(GatewayUnavailable::class);
});

it('keeps sub-merchant keys stable and refunds once per idempotency key', function (): void {
    $gateway = app(FakeGateway::class);
    $data = new SubMerchantData('shop-1', 'Fırın', 'Adres', 'a@example.test', '+905000000000', str_repeat('0', 10), 'TR'.str_repeat('0', 24), 'PERSONAL');
    $request = new RefundRequest('d-1', 'pay-1', 3_000, 'TRY', 'key-1', 'test');

    $first = $gateway->refund($request);
    $gateway->scriptRefund('pay-1', false);
    $replay = $gateway->refund($request);
    $other = $gateway->refund(new RefundRequest('d-2', 'pay-1', 3_000, 'TRY', 'key-2', 'test'));

    expect($gateway->createSubMerchant(new Shop, $data)->subMerchantKey)->toBe($gateway->createSubMerchant(new Shop, $data)->subMerchantKey)
        ->and($first->succeeded)->toBeTrue()
        ->and($replay)->toEqual($first)
        ->and($other->succeeded)->toBeFalse();
});

it('lists scripted settlements inside the period only', function (): void {
    $gateway = app(FakeGateway::class);
    $gateway->scriptSettlements('sm-1', [
        new SettlementRecord('s-1', 'sm-1', 2_850, 'TRY', 'paid', CarbonImmutable::parse('2026-10-01')),
        new SettlementRecord('s-2', 'sm-1', 1_000, 'TRY', 'pending', CarbonImmutable::parse('2026-10-05')),
    ]);

    $records = $gateway->listSettlements('sm-1', CarbonPeriod::create('2026-10-01', '2026-10-03'));

    expect($records)->toHaveCount(1)->and($records[0]->settlementId)->toBe('s-1')
        ->and($gateway->listSettlements('sm-other', CarbonPeriod::create('2026-10-01', '2026-10-31')))->toBe([]);
});
