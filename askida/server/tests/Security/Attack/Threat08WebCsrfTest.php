<?php

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| Threat 4.8, CSRF on the web. The CSRF check is switched back on for these tests (the
| framework skips it in unit tests). A cross-site POST to the account deletion page is
| refused with 419 and changes nothing; a GET never changes state; the provider callback
| is the only state-changing web route without the check, and it acts only on a known
| provider token re-read from the provider. The API answers no foreign origin.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    $this->app->bind(PreventRequestForgery::class, fn ($app) => new class($app, $app['encrypter']) extends PreventRequestForgery
    {
        protected function runningUnitTests()
        {
            return false;
        }
    });
});

it('refuses a cross-site deletion post without a token or with a foreign token', function (array $tokenParts): void {
    $user = User::factory()->create();

    $response = $this->withSession(['_token' => 'victim-session-token'])
        ->withHeaders($tokenParts['headers'] ?? [])
        ->post('/hesap-silme', ['email' => $user->email, 'password' => UserFactory::PASSWORD] + ($tokenParts['body'] ?? []));

    $response->assertStatus(419);
    expect($user->fresh()?->deactivated_at)->toBeNull()
        ->and($user->fresh()?->tokens()->count())->toBe(0);
})->with([
    'no token' => [[]],
    'attacker token in the body' => [['body' => ['_token' => 'attacker-own-token']]],
    'attacker token in the header' => [['headers' => ['X-CSRF-TOKEN' => 'attacker-own-token']]],
    'empty token' => [['body' => ['_token' => '']]],
]);

it('negative control: the same post with the page token deactivates the account', function (): void {
    $user = User::factory()->create();

    $token = 'page-token-'.bin2hex(random_bytes(4));

    $this->withSession(['_token' => $token])
        ->post('/hesap-silme', ['_token' => $token, 'email' => $user->email, 'password' => UserFactory::PASSWORD])
        ->assertOk();
    expect($user->fresh()?->deactivated_at)->not->toBeNull();
});

it('changes nothing on a GET carrying the form fields', function (): void {
    $user = User::factory()->create();

    $this->get('/hesap-silme?email='.urlencode((string) $user->email).'&password='.urlencode(UserFactory::PASSWORD))->assertOk();

    expect($user->fresh()?->deactivated_at)->toBeNull();
});

it('exempts only the provider callback among the state-changing web routes', function (): void {
    $exempt = [];
    $checked = 0;

    /** @var RouteDefinition $route */
    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (str_starts_with($route->uri(), 'api/') || array_intersect($route->methods(), ['POST', 'PUT', 'PATCH', 'DELETE']) === []) {
            continue;
        }

        $checked++;
        // Groups expanded to classes, exclusions applied: exactly what runs for the route.
        $protected = collect(app('router')->gatherRouteMiddleware($route))
            ->contains(fn (mixed $middleware): bool => is_string($middleware) && is_a((string) strtok($middleware, ':'), PreventRequestForgery::class, true));

        if (! $protected) {
            $exempt[] = $route->getName() ?? $route->uri();
        }
    }

    sort($exempt);

    // storage.local.upload is the framework's signed upload route of the local disk; it is
    // refused without a valid URL signature (next test).
    expect($checked)->toBeGreaterThan(5)
        ->and($exempt)->toBe(['storage.local.upload', 'web.pay.callback']);
});

it('refuses the local-disk upload route without a valid signature and writes nothing', function (): void {
    $route = Route::getRoutes()->getByName('storage.local.upload');
    expect($route)->not->toBeNull();

    $path = 'attack-'.bin2hex(random_bytes(4)).'.txt';
    $uri = '/'.str_replace('{path}', $path, (string) $route?->uri());

    $response = $this->call('PUT', $uri.'?expires=9999999999&signature='.str_repeat('0', 64), [], [], [], ['CONTENT_TYPE' => 'text/plain'], 'planted');

    expect($response->status())->toBe(403)
        ->and(Storage::disk('local')->exists($path))->toBeFalse();
});

it('answers a cross-site callback post without a known provider token with 404 and settles nothing', function (): void {
    $gateway = PaymentWorld::useFakeGateway();
    $donation = PaymentWorld::initiated(PaymentWorld::item(PaymentWorld::payableShop()));
    $gateway->scriptPayment((string) $donation->provider_token, ProviderPaymentStatus::Success, $donation->amount_minor, 'TRY', $donation->conversation_id);

    $this->post('/pay/callback', ['donation_id' => $donation->id, 'status' => 'success'])->assertNotFound();
    expect($donation->fresh()?->status)->toBe(DonationStatus::Initiated);

    // Negative control: with the provider token (what the provider posts) it settles, no CSRF token needed.
    $this->post('/pay/callback', ['token' => (string) $donation->provider_token])->assertOk();
    expect($donation->fresh()?->status)->toBe(DonationStatus::Paid);
});

it('does not hand API answers to a foreign origin', function (): void {
    $token = HookWorld::userToken(HookWorld::donor());

    $preflight = $this->call('OPTIONS', '/api/v1/me', [], [], [], [
        'HTTP_ORIGIN' => 'https://evil.example',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization',
    ]);
    $read = $this->withHeaders(['Origin' => 'https://evil.example', 'Authorization' => 'Bearer '.$token])->getJson('/api/v1/me');

    expect($preflight->headers->get('Access-Control-Allow-Origin'))->toBeNull()
        ->and($read->headers->get('Access-Control-Allow-Origin'))->toBeNull()
        ->and($read->headers->get('Access-Control-Allow-Credentials'))->toBeNull()
        ->and($read->headers->get('Set-Cookie'))->toBeNull();
});
