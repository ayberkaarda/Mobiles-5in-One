<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Jobs\SendDonationReceipt;
use App\Domain\Payments\Services\PayPageStore;
use App\Http\Controllers\Web\PayController;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Donations\Support\PaymentWorld;

/*
| Pay page and provider callback (/pay/*, security items 9, 14, 17): renders only payable
| donations, never trusts a posted status, CSP of the pay profile, no personal data in logs.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->fake = PaymentWorld::useFakeGateway();
    Queue::fake([SendDonationReceipt::class]);
    $this->shop = PaymentWorld::payableShop();
    $this->item = PaymentWorld::item($this->shop, 1_500);
    $this->donor = PaymentWorld::donor();
    $response = $this->withToken(PaymentWorld::token($this->donor))->postJson('/api/v1/donations', [
        'shop_id' => $this->shop->id, 'item_id' => $this->item->id, 'qty' => 2,
    ])->assertCreated();
    app('auth')->forgetGuards();
    $this->withoutToken();
    $this->donation = Donation::query()->findOrFail($response->json('donation_id'));
    $this->token = (string) $this->donation->provider_token;
});

function callback(object $test, array $body): TestResponse
{
    return $test->post('/pay/callback', $body);
}

it('renders the checkout with item, quantity, amount and commission and the token-only form', function (): void {
    $response = $this->get('/pay/'.$this->token)->assertOk();

    $response->assertSee('Askıya bırak')->assertSee('Ekmek')
        ->assertSee('30,00 ₺')->assertSee('Esnafa giden')->assertSee('28,50 ₺')
        ->assertSee('Platform komisyonu')->assertSee('1,50 ₺')
        ->assertSee('action="/pay/callback"', false)
        ->assertSee('name="token" value="'.$this->token.'"', false)
        ->assertSee('noindex', false)
        ->assertHeader('Cache-Control', 'no-store, private');
    expect($response->getContent())->not->toContain('googletagmanager')->not->toContain('analytics');
});

it('answers 404 for unknown, malformed, expired, failed and paid donations', function (Closure $prepare): void {
    $path = $prepare($this);

    $this->get($path)->assertNotFound();
})->with([
    'unknown token' => [fn ($t) => '/pay/fake-'.str_repeat('0', 40)],
    'malformed token' => [fn ($t) => '/pay/'.rawurlencode('<script>')],
    'page expired' => [function ($t) {
        app(PayPageStore::class)->forget($t->token);

        return '/pay/'.$t->token;
    }],
    'donation too old' => [function ($t) {
        $t->travel(31)->minutes();

        return '/pay/'.$t->token;
    }],
    'failed' => [function ($t) {
        $t->donation->forceFill(['status' => DonationStatus::Failed])->save();

        return '/pay/'.$t->token;
    }],
    'paid' => [function ($t) {
        $t->donation->forceFill(['status' => DonationStatus::Paid, 'paid_at' => now()])->save();

        return '/pay/'.$t->token;
    }],
]);

it('sends the pay CSP with a nonce, frame-src from config and no frames by default', function (): void {
    $default = $this->get('/pay/'.$this->token)->assertOk();
    $csp = (string) $default->headers->get('Content-Security-Policy');
    preg_match("/script-src 'self' 'nonce-([^']+)'/", $csp, $nonce);

    expect($csp)->toContain("frame-src 'none'")->toContain("frame-ancestors 'none'")->toContain("form-action 'self'")
        ->and($nonce[1] ?? null)->not->toBeNull()
        ->and($default->getContent())->toContain('<style nonce="'.$nonce[1].'"');

    config(['secure-headers.csp_profiles.pay.frame-src' => ['allow' => ['https://sandbox-cpp.iyzipay.com']]]);
    $framed = (string) $this->get('/pay/'.$this->token)->headers->get('Content-Security-Policy');
    expect($framed)->toContain('frame-src https://sandbox-cpp.iyzipay.com');
});

it('gives provider scripts the request nonce', function (): void {
    expect(PayController::withNonce('<div></div><script src="x"></script><SCRIPT>a()</SCRIPT><script nonce="n">b()</script>', 'abc'))
        ->toBe('<div></div><script nonce="abc" src="x"></script><SCRIPT nonce="abc">a()</SCRIPT><script nonce="n">b()</script>');
});

it('settles from the server-side lookup and deep-links back to the app', function (): void {
    $response = callback($this, ['token' => $this->token])->assertOk();

    $response->assertSee('Teşekkürler!')
        ->assertSee('askida://donation/'.$this->donation->id.'?status=paid', false);
    preg_match("/script-src 'self' 'nonce-([^']+)'/", (string) $response->headers->get('Content-Security-Policy'), $nonce);
    expect($response->getContent())->toContain('<script nonce="'.$nonce[1].'"')
        ->and($this->donation->refresh()->status)->toBe(DonationStatus::Paid)
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(2);
});

it('ignores a forged success status when the provider says the payment failed', function (): void {
    $this->fake->scriptPayment($this->token, ProviderPaymentStatus::Failure, 0, 'TRY', $this->donation->conversation_id);

    callback($this, ['token' => $this->token, 'status' => 'success', 'paymentStatus' => 'SUCCESS', 'paidPrice' => '30.00'])
        ->assertOk()->assertSee('askida://donation/'.$this->donation->id.'?status=failed', false);

    expect($this->donation->refresh()->status)->toBe(DonationStatus::Failed)
        ->and(Hook::query()->count())->toBe(0);
});

it('keeps the donation initiated on a forged success while the provider is still pending', function (): void {
    $this->fake->scriptPayment($this->token, ProviderPaymentStatus::Pending);

    callback($this, ['token' => $this->token, 'status' => 'success'])
        ->assertOk()->assertSee('?status=pending', false);

    expect($this->donation->refresh()->status)->toBe(DonationStatus::Initiated);
});

it('shows pending when the provider cannot be reached', function (): void {
    $this->fake->scriptUnavailable($this->token);

    callback($this, ['token' => $this->token])->assertOk()->assertSee('?status=pending', false);
    expect($this->donation->refresh()->status)->toBe(DonationStatus::Initiated);
});

it('is safe to replay: one transition, qty units, and the page stays paid', function (): void {
    foreach (range(1, 3) as $attempt) {
        callback($this, ['token' => $this->token])->assertOk()->assertSee('?status=paid', false);
    }

    expect(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(2);
    Queue::assertPushedTimes(SendDonationReceipt::class, 1);
    $this->get('/pay/'.$this->token)->assertNotFound();
});

it('answers 404 to unknown or missing tokens', function (array $body): void {
    callback($this, $body)->assertNotFound();
})->with([
    'unknown' => [['token' => 'fake-'.str_repeat('1', 40)]],
    'missing' => [[]],
    'array' => [['token' => ['a']]],
    'status only' => [['status' => 'success']],
]);

it('needs no CSRF token but stays CSRF-protected elsewhere on the web', function (): void {
    $this->app->bind(PreventRequestForgery::class, fn ($app) => new class($app, $app['encrypter']) extends PreventRequestForgery
    {
        protected function runningUnitTests()
        {
            return false;
        }
    });

    $this->post('/pay/callback', ['token' => $this->token])->assertOk();
    $this->post('/hesap-silme', ['email' => 'a@example.test', 'password' => 'x'])->assertStatus(419);
});

it('limits callbacks to 60 per minute per IP', function (): void {
    foreach (range(1, 60) as $attempt) {
        callback($this, ['token' => 'fake-'.Str::lower(Str::random(40))])->assertNotFound();
    }

    callback($this, ['token' => $this->token])->assertStatus(429);
});

it('writes no token, e-mail or body of the pay flow to the log', function (): void {
    $logPath = storage_path('logs/test-pay-'.bin2hex(random_bytes(4)).'.log');
    config([
        'logging.default' => 'stack',
        'logging.channels.stack.channels' => ['single'],
        'logging.channels.single.path' => $logPath,
        'logging.channels.single.level' => 'debug',
    ]);
    app('log')->forgetChannel('stack');
    app('log')->forgetChannel('single');

    $this->get('/pay/'.$this->token)->assertOk();
    callback($this, ['token' => $this->token, 'email' => $this->donor->email])->assertOk();
    $log = File::exists($logPath) ? File::get($logPath) : '';
    File::delete($logPath);

    expect($log)->toContain('pay/{token}')->toContain('pay/callback')
        ->not->toContain($this->token)
        ->not->toContain($this->donor->email)
        ->not->toContain((string) $this->donation->conversation_id);
});
