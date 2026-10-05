<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Security\Attack\AttackKit;

/*
| Spoofed headers (cross-cutting, threat model 4.12 "forged client address and host
| headers"). Without a configured trusted proxy, X-Forwarded-For does not choose the
| limiter bucket and X-Forwarded-Proto does not make a request secure; absolute
| URLs (pay links, canonical links, cached pages, sitemap, robots) name the configured
| origin whatever Host or X-Forwarded-Host the client sends.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    config(['trustedproxy.proxies' => [], 'web.origin' => 'https://askida.app']);
});

function attack12Login(string $ip, array $headers = []): TestResponse
{
    return AttackKit::json('POST', '/api/v1/auth/login', null, [
        'email' => 'nobody-'.Str::lower(Str::random(10)).'@example.test',
        'password' => AuthTestKit::password(),
        'device_name' => AuthTestKit::DEVICE,
        'platform' => 'android',
    ], $headers, $ip);
}

it('keeps the sign-in limiter on the peer address whatever X-Forwarded-For says', function (): void {
    for ($i = 0; $i < 5; $i++) {
        AttackKit::assertProblem(attack12Login('198.51.100.40', ['X-Forwarded-For' => '203.0.113.'.$i]), 401, 'auth.invalid_credentials');
    }

    AttackKit::assertProblem(attack12Login('198.51.100.40', ['X-Forwarded-For' => '203.0.113.200', 'X-Real-IP' => '203.0.113.201']), 429, 'rate_limited');

    // Negative control: another peer address has its own bucket.
    AttackKit::assertProblem(attack12Login('198.51.100.41'), 401, 'auth.invalid_credentials');
});

it('honours X-Forwarded-For only from a configured trusted proxy', function (): void {
    config(['trustedproxy.proxies' => ['10.0.0.0/8']]);

    for ($i = 0; $i < 5; $i++) {
        attack12Login('10.1.2.3', ['X-Forwarded-For' => '203.0.113.50']);
    }

    AttackKit::assertProblem(attack12Login('10.1.2.3', ['X-Forwarded-For' => '203.0.113.50']), 429, 'rate_limited');
    AttackKit::assertProblem(attack12Login('10.1.2.3', ['X-Forwarded-For' => '203.0.113.51']), 401, 'auth.invalid_credentials');
});

it('does not treat a spoofed X-Forwarded-Proto as HTTPS in production', function (): void {
    app()->detectEnvironment(fn (): string => 'production');

    $response = AttackKit::json('GET', 'http://localhost/api/v1/impact', null, [], ['X-Forwarded-Proto' => 'https', 'X-Forwarded-Port' => '443']);

    AttackKit::assertProblem($response, 403, 'https_required');
});

it('builds the pay link from APP_URL under a forged Host', function (): void {
    PaymentWorld::useFakeGateway();
    $item = PaymentWorld::item(PaymentWorld::payableShop());

    $response = AttackKit::json('POST', 'http://evil.example/api/v1/donations', PaymentWorld::token(PaymentWorld::donor()), [
        'shop_id' => $item->shop_id, 'item_id' => $item->id, 'qty' => 1,
    ], ['X-Forwarded-Host' => 'evil.example'])->assertCreated();

    expect((string) $response->json('checkout_url'))->toStartWith('https://askida.test/pay/')->not->toContain('evil');
});

it('never names a forged host in public pages, and a poisoned request does not reach the page cache', function (string $path): void {
    config(['responsecache.enabled' => true]);

    $poisoned = $this->get('http://evil.example'.$path, ['X-Forwarded-Host' => 'evil.example']);
    $clean = $this->get('http://localhost'.$path);

    expect($poisoned->status())->toBe(200)
        ->and((string) $poisoned->getContent())->not->toContain('evil.example')
        ->and((string) $clean->getContent())->not->toContain('evil.example')
        ->and((string) $clean->getContent())->toContain('https://askida.app');
})->with(['/', '/sitemap.xml', '/robots.txt', '/llms.txt']);
