<?php

use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\SubMerchantData;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Gateways\IyzicoGateway;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonPeriod;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Feature\Api\Donations\Support\PaymentWorld;

/*
| The provider's HTTP API, proven against fixtures built at run time with Http::fake.
| Not exercised against the provider: no sandbox account (ADR-0006 wording).
*/

beforeEach(function (): void {
    Http::preventStrayRequests();
    PaymentWorld::providerKeys();
    $this->logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event): void {
        $this->logged[] = $event->message.' '.json_encode($event->context);
    });
});

function iyzicoCheckoutRequest(string $conversation): CheckoutRequest
{
    return new CheckoutRequest(
        donationId: (string) Str::uuid7(),
        conversationId: $conversation,
        subMerchantKey: 'sm-key-'.Str::lower(Str::random(8)),
        itemId: (string) Str::uuid7(),
        itemName: 'Ekmek',
        qty: 2,
        unitPriceMinor: 1_500,
        amountMinor: 3_000,
        commissionMinor: 150,
        currency: 'TRY',
        callbackUrl: 'https://askida.test/pay/callback',
        buyerReference: (string) Str::uuid7(),
    );
}

function iyzicoUrl(string $path): string
{
    return 'https://sandbox-api.iyzipay.test'.$path;
}

it('opens a checkout with a signed request, a server split per sub-merchant and no personal buyer data', function (): void {
    $token = 'tok-'.Str::random(24);
    Http::fake([iyzicoUrl(IyzicoGateway::PATH_CHECKOUT_INITIALIZE) => Http::response([
        'status' => 'success',
        'token' => $token,
        'checkoutFormContent' => '<script type="text/javascript">var iyziInit = {};</script>',
        'paymentPageUrl' => 'https://sandbox-cpp.iyzipay.com?token='.$token,
    ])]);
    $request = iyzicoCheckoutRequest($conversation = (string) Str::uuid7());

    $session = (new IyzicoGateway)->initializeCheckout($request);

    expect($session->providerToken)->toBe($token)
        ->and($session->paymentPageHtml)->toContain('id="iyzipay-checkout-form"')
        ->toContain('<script type="text/javascript">')
        ->toContain('href="https://sandbox-cpp.iyzipay.com?token='.$token.'"');

    Http::assertSent(function (Request $sent) use ($request, $conversation): bool {
        $body = $sent->body();
        $data = json_decode($body, true);
        $random = $sent->header('x-iyzi-rnd')[0];
        $credentials = base64_decode(Str::after($sent->header('Authorization')[0], 'IYZWSv2 '), true);
        $signature = hash_hmac('sha256', $random.IyzicoGateway::PATH_CHECKOUT_INITIALIZE.$body, (string) config('services.iyzico.secret_key'));

        return $credentials === 'apiKey:'.config('services.iyzico.api_key').'&randomKey:'.$random.'&signature:'.$signature
            && $data['price'] === '30.00' && $data['paidPrice'] === '30.00' && $data['currency'] === 'TRY'
            && $data['basketId'] === $conversation && $data['conversationId'] === $conversation
            && $data['basketItems'][0]['subMerchantKey'] === $request->subMerchantKey
            && $data['basketItems'][0]['price'] === '30.00'
            && $data['basketItems'][0]['subMerchantPrice'] === '28.50'
            && $data['buyer']['id'] === $request->buyerReference
            && str_ends_with($data['buyer']['email'], '@buyers.askida.app')
            && $data['callbackUrl'] === 'https://askida.test/pay/callback';
    });
});

it('drops a fallback link that is not an https iyzipay host', function (string $url): void {
    Http::fake(['*' => Http::response(['status' => 'success', 'token' => 'tok-abcdefgh', 'checkoutFormContent' => '<div></div>', 'paymentPageUrl' => $url])]);

    expect((new IyzicoGateway)->initializeCheckout(iyzicoCheckoutRequest('c-1'))->paymentPageHtml)->not->toContain('pay-fallback');
})->with(['http://sandbox-cpp.iyzipay.com/x', 'https://iyzipay.com.evil.test/x', 'javascript:alert(1)']);

it('never retries a checkout initialisation and fails closed on refusals and server errors', function (array $response, int $status): void {
    Http::fake(['*' => Http::response($response, $status)]);

    expect(fn () => (new IyzicoGateway)->initializeCheckout(iyzicoCheckoutRequest('c-2')))->toThrow(GatewayUnavailable::class);
    Http::assertSentCount(1);
})->with([
    'refused' => [['status' => 'failure', 'errorCode' => '1000', 'errorMessage' => 'refused'], 200],
    'server error' => [['status' => 'failure'], 503],
    'no token' => [['status' => 'success', 'checkoutFormContent' => '<div></div>'], 200],
]);

it('maps a successful payment detail', function (): void {
    Http::fake([iyzicoUrl(IyzicoGateway::PATH_CHECKOUT_DETAIL) => Http::response([
        'status' => 'success',
        'paymentStatus' => 'SUCCESS',
        'paidPrice' => 30.0,
        'currency' => 'TRY',
        'paymentId' => '9988',
        'basketId' => 'conv-1',
        'conversationId' => 'other',
        'itemTransactions' => [['itemId' => 'item-1', 'paidPrice' => '30.0', 'subMerchantKey' => 'sm-1', 'subMerchantPayoutAmount' => '28.5']],
    ])]);

    $payment = (new IyzicoGateway)->retrievePayment('tok-1234567890');

    expect($payment->status)->toBe(ProviderPaymentStatus::Success)
        ->and($payment->paidAmountMinor)->toBe(3_000)
        ->and($payment->currency)->toBe('TRY')
        ->and($payment->providerPaymentId)->toBe('9988')
        ->and($payment->conversationId)->toBe('conv-1')
        ->and($payment->items[0]->subMerchantPayoutMinor)->toBe(2_850);
    Http::assertSent(fn (Request $sent): bool => $sent['token'] === 'tok-1234567890');
});

it('maps declined and in-progress payments', function (array $body, ProviderPaymentStatus $expected): void {
    Http::fake(['*' => Http::response($body)]);

    expect((new IyzicoGateway)->retrievePayment('tok-1234567890')->status)->toBe($expected);
})->with([
    'declined' => [['status' => 'failure', 'errorCode' => '10051', 'paymentStatus' => 'FAILURE', 'basketId' => 'c'], ProviderPaymentStatus::Failure],
    'three d secure pending' => [['status' => 'success', 'paymentStatus' => 'INIT_THREEDS', 'basketId' => 'c'], ProviderPaymentStatus::Pending],
]);

it('treats a refused lookup as unavailable, never as a failed payment', function (): void {
    Http::fake(['*' => Http::response(['status' => 'failure', 'errorCode' => '1001'])]);

    expect(fn () => (new IyzicoGateway)->retrievePayment('tok-1234567890'))->toThrow(GatewayUnavailable::class);
});

it('retries a payment lookup on server errors up to three attempts', function (): void {
    Http::fake(['*' => Http::response(['status' => 'failure'], 502)]);

    expect(fn () => (new IyzicoGateway)->retrievePayment('tok-1234567890'))->toThrow(GatewayUnavailable::class);
    Http::assertSentCount(3);
});

it('retries a payment lookup after a connection error and then succeeds', function (): void {
    Http::fakeSequence()
        ->pushFailedConnection()
        ->push(['status' => 'success', 'paymentStatus' => 'SUCCESS', 'paidPrice' => '15.00', 'currency' => 'TRY', 'basketId' => 'c']);

    expect((new IyzicoGateway)->retrievePayment('tok-1234567890')->paidAmountMinor)->toBe(1_500);
    Http::assertSentCount(2);
});

it('fails closed on a malformed amount', function (): void {
    Http::fake(['*' => Http::response(['status' => 'success', 'paymentStatus' => 'SUCCESS', 'paidPrice' => 'thirty', 'currency' => 'TRY'])]);

    expect(fn () => (new IyzicoGateway)->retrievePayment('tok-1234567890'))->toThrow(GatewayUnavailable::class);
});

it('sends nothing without credentials or over plain http', function (array $config): void {
    config($config);
    Http::fake();

    expect(fn () => (new IyzicoGateway)->retrievePayment('tok-1234567890'))->toThrow(GatewayUnavailable::class);
    Http::assertNothingSent();
})->with([
    'no api key' => [['services.iyzico.api_key' => null]],
    'no secret' => [['services.iyzico.secret_key' => '']],
    'plain http' => [['services.iyzico.base_url' => 'http://sandbox-api.iyzipay.test']],
]);

it('refunds by payment id and reports a refusal as a result', function (): void {
    Http::fakeSequence()
        ->push(['status' => 'success', 'paymentId' => '9988', 'price' => '30.00', 'hostReference' => 'ref-1'])
        ->push(['status' => 'failure', 'errorCode' => '5000']);
    $request = new RefundRequest((string) Str::uuid7(), '9988', 3_000, 'TRY', 'refund-key-1', 'shop rejected');

    $ok = (new IyzicoGateway)->refund($request);
    $refused = (new IyzicoGateway)->refund($request);

    expect($ok->succeeded)->toBeTrue()->and($ok->refundedAmountMinor)->toBe(3_000)->and($ok->providerRefundId)->toBe('ref-1')
        ->and($refused->succeeded)->toBeFalse()->and($refused->refundedAmountMinor)->toBe(0);
    Http::assertSent(fn (Request $sent): bool => $sent->url() === iyzicoUrl(IyzicoGateway::PATH_REFUND)
        && $sent['paymentId'] === '9988' && $sent['price'] === '30.00' && $sent['conversationId'] === 'refund-key-1');
});

it('creates a sub-merchant and falls back to the existing one by external id', function (): void {
    $taxNumber = implode('', array_fill(0, 10, '0'));
    $iban = 'TR'.str_repeat('0', 24);
    $data = new SubMerchantData('shop-ext-1', 'Deneme Fırını', 'Deneme Sokak 1', 'shop@example.test', '+905000000000', $taxNumber, $iban, 'PRIVATE_COMPANY');
    Http::fakeSequence()
        ->push(['status' => 'success', 'subMerchantKey' => 'sm-new'])
        ->push(['status' => 'failure', 'errorCode' => '2001'])
        ->push(['status' => 'success', 'subMerchantKey' => 'sm-existing']);

    expect((new IyzicoGateway)->createSubMerchant(new Shop, $data)->subMerchantKey)->toBe('sm-new')
        ->and((new IyzicoGateway)->createSubMerchant(new Shop, $data)->subMerchantKey)->toBe('sm-existing');
    Http::assertSent(fn (Request $sent): bool => $sent->url() === iyzicoUrl(IyzicoGateway::PATH_SUB_MERCHANT_DETAIL)
        && $sent['subMerchantExternalId'] === 'shop-ext-1');
});

it('reads completed payouts per day for one sub-merchant', function (): void {
    Http::fakeSequence()
        ->push(['status' => 'success', 'payoutCompletedTransactions' => [
            ['payoutType' => 'SUB_MERCHANT', 'subMerchantKey' => 'sm-1', 'payoutAmount' => '28.50', 'currency' => 'TRY'],
            ['payoutType' => 'SUB_MERCHANT', 'subMerchantKey' => 'sm-1', 'payoutAmount' => 10, 'currency' => 'TRY'],
            ['payoutType' => 'SUB_MERCHANT', 'subMerchantKey' => 'sm-2', 'payoutAmount' => '99.00', 'currency' => 'TRY'],
            ['payoutType' => 'MERCHANT', 'payoutAmount' => '1.50', 'currency' => 'TRY'],
        ]])
        ->push(['status' => 'success', 'payoutCompletedTransactions' => []]);

    $records = (new IyzicoGateway)->listSettlements('sm-1', CarbonPeriod::create('2026-10-01', '2026-10-02'));

    expect($records)->toHaveCount(1)
        ->and($records[0]->amountMinor)->toBe(3_850)
        ->and($records[0]->status)->toBe('paid')
        ->and($records[0]->settlementDate->toDateString())->toBe('2026-10-01')
        ->and($records[0]->settlementId)->toBe('iyz-'.substr(hash('sha256', 'sm-1|2026-10-01'), 0, 32));
    Http::assertSentCount(2);
});

it('never writes keys, tokens or bodies to the log', function (): void {
    Http::fake(['*' => Http::response(['status' => 'failure', 'errorCode' => '1001', 'errorMessage' => 'echo of the request'], 200)]);

    try {
        (new IyzicoGateway)->retrievePayment('tok-secretish-1234');
    } catch (GatewayUnavailable) {
    }

    $log = implode("\n", $this->logged);
    expect($log)->toContain('payments.provider_call_failed')
        ->not->toContain((string) config('services.iyzico.api_key'))
        ->not->toContain((string) config('services.iyzico.secret_key'))
        ->not->toContain('tok-secretish-1234')
        ->not->toContain('echo of the request');
});

it('checks the published amount format both ways', function (): void {
    expect(App\Domain\Payments\Gateways\Iyzico\IyzicoMoney::format(150_050))->toBe('1500.50')
        ->and(App\Domain\Payments\Gateways\Iyzico\IyzicoMoney::format(5))->toBe('0.05')
        ->and(App\Domain\Payments\Gateways\Iyzico\IyzicoMoney::parse('1500.5'))->toBe(150_050)
        ->and(App\Domain\Payments\Gateways\Iyzico\IyzicoMoney::parse(15.1))->toBe(1_510)
        ->and(App\Domain\Payments\Gateways\Iyzico\IyzicoMoney::parse('0.995'))->toBe(100);
});
