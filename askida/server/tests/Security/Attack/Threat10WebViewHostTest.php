<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Gateways\FakeGateway;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Security\Attack\AttackKit;

/*
| Threat 4.10, WebView phishing. The pay page a WebView opens is created by the server for
| one donation: its address comes from APP_URL (never from the request), its CSP lets
| frames come only from the configured provider hosts and forbids being framed, and every
| token that is not a live checkout (unknown, malformed, paid, too old) is a 404.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    PaymentWorld::useFakeGateway();
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
});

/**
 * Starts a donation through the API and returns the donation and its pay page path.
 *
 * @return array{donation: Donation, path: string, url: string}
 */
function attack10Checkout(string $origin = '', array $headers = []): array
{
    $item = PaymentWorld::item(PaymentWorld::payableShop());
    $response = AttackKit::json('POST', $origin.'/api/v1/donations', PaymentWorld::token(PaymentWorld::donor()), [
        'shop_id' => $item->shop_id, 'item_id' => $item->id, 'qty' => 1,
    ], $headers)->assertCreated();
    $url = (string) $response->json('checkout_url');

    return [
        'donation' => Donation::query()->findOrFail($response->json('donation_id')),
        'path' => (string) parse_url($url, PHP_URL_PATH),
        'url' => $url,
    ];
}

/**
 * @return array<string, string> directive => value
 */
function attack10Csp(TestResponse $response): array
{
    $directives = [];

    foreach (explode(';', (string) $response->headers->get('Content-Security-Policy')) as $part) {
        $part = trim($part);

        if ($part !== '') {
            [$name, $value] = array_pad(explode(' ', $part, 2), 2, '');
            $directives[$name] = $value;
        }
    }

    return $directives;
}

it('builds the pay URL from the configured origin, not from a forged Host header', function (): void {
    $checkout = attack10Checkout('http://evil.example', ['X-Forwarded-Host' => 'evil.example', 'X-Forwarded-Proto' => 'http']);

    expect($checkout['url'])->toStartWith('https://askida.test/pay/')
        ->not->toContain('evil.example');
});

it('lets frames come only from the configured provider hosts and is never framed itself', function (): void {
    config(['secure-headers.csp_profiles.pay.frame-src' => ['allow' => ['https://checkout.provider.example']]]);
    $checkout = attack10Checkout();

    $page = $this->get($checkout['path'])->assertOk();
    $csp = attack10Csp($page);

    expect($csp['frame-src'] ?? null)->toBe('https://checkout.provider.example')
        ->and($csp['frame-ancestors'] ?? null)->toBe("'none'")
        ->and($csp['form-action'] ?? null)->toBe("'self'")
        ->and($csp['script-src'] ?? '')->not->toContain('*')->not->toContain('unsafe-eval')
        ->and(strtoupper((string) $page->headers->get('X-Frame-Options')))->toBe('DENY')
        ->and($page->headers->get('Cache-Control'))->toContain('no-store');
});

it('allows no frame at all when no provider host is configured', function (): void {
    config(['secure-headers.csp_profiles.pay.frame-src' => ['none' => true]]);
    $checkout = attack10Checkout();

    expect(attack10Csp($this->get($checkout['path'])->assertOk())['frame-src'] ?? null)->toBe("'none'");
});

it('answers every token that is not a live checkout with 404', function (string $case): void {
    $checkout = attack10Checkout();
    $path = $checkout['path'];

    $path = match ($case) {
        'unknown' => '/pay/'.FakeGateway::tokenFor('never-opened'),
        'malformed' => '/pay/'.rawurlencode('<script>alert(1)</script>'),
        'too short' => '/pay/abc',
        'paid' => (function () use ($checkout, $path): string {
            $checkout['donation']->forceFill(['status' => DonationStatus::Paid, 'paid_at' => now()])->save();

            return $path;
        })(),
        'too old' => (function () use ($path): string {
            $this->travel((int) config('payments.caps.initiated_window_minutes', 30) + 1)->minutes();

            return $path;
        })(),
    };

    $response = $this->get($path);

    $response->assertNotFound();
    expect((string) $response->getContent())->not->toContain('fake-checkout')->not->toContain('<script>alert(1)');
})->with(['unknown', 'malformed', 'too short', 'paid', 'too old']);

it('negative control: the live checkout page renders the provider form', function (): void {
    $checkout = attack10Checkout();

    $this->get($checkout['path'])->assertOk()->assertSee('fake-checkout', false);
});
