<?php

namespace Tests\Support\OpenApi;

use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use Pest\Support\HigherOrderTapProxy;
use PHPUnit\Framework\Assert;
use Symfony\Component\HttpFoundation\Response;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/**
 * Fixtures and HTTP calls for the OpenAPI contract test.
 *
 * Tokens: user tokens come from the real sign-in endpoints or from the same
 * DeviceTokenIssuer the endpoints use; anon tokens come from POST anon/attest, which in
 * the testing environment is answered by the simulated attestation verifier (any token
 * passes, one starting with `reject` fails, one starting with `unavailable` simulates an
 * outage). Every secret-like value (pepper, nonces, codes, tokens) is made at run time.
 */
final class ContractWorld
{
    public static function boot(): void
    {
        AuthTestKit::boot();
        HookWorld::pepper();
        config(['askida.allow_sample_shops' => false]);
    }

    public static function case(): TestCase
    {
        $proxy = test();
        $case = $proxy instanceof HigherOrderTapProxy ? $proxy->target : $proxy;
        Assert::assertInstanceOf(TestCase::class, $case);

        return $case;
    }

    /**
     * One request through the HTTP kernel with a clean header set and fresh guards, so
     * each call authenticates only from its own bearer token.
     *
     * @param  array<string, mixed>|null  $body
     * @return TestResponse<Response>
     */
    public static function call(string $method, string $uri, ?array $body = null, ?string $token = null): TestResponse
    {
        $case = self::case();
        $case->flushHeaders();
        app('auth')->forgetGuards();

        if ($token !== null) {
            $case->withToken($token);
        }

        return $case->json($method, $uri, $body ?? []);
    }

    /**
     * A call whose request is first checked against the document.
     *
     * @param  array<string, mixed>|null  $body
     * @return TestResponse<Response>
     */
    public static function send(string $method, string $uri, ?array $body = null, ?string $token = null): TestResponse
    {
        OpenApiContract::assertRequest($method, $uri, $body, $token === null ? [] : ['Authorization' => 'Bearer '.$token]);

        return self::call($method, $uri, $body, $token);
    }

    /**
     * Limiter and lockout state lives in the array cache store during tests.
     */
    public static function resetLimits(): void
    {
        Cache::flush();
    }

    public static function token(User $user): string
    {
        return AuthTestKit::token($user, 'contract-'.bin2hex(random_bytes(3)));
    }

    public static function deviceNonce(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    }

    /**
     * An anon token issued by the real attestation endpoint.
     */
    public static function anonToken(): string
    {
        $response = self::call('POST', '/api/v1/anon/attest', [
            'platform' => 'android',
            'token' => 'attestation-'.bin2hex(random_bytes(4)),
            'device_nonce' => self::deviceNonce(),
        ]);
        $response->assertOk();

        $token = $response->json('token');
        Assert::assertIsString($token);

        return $token;
    }

    public static function merchant(): User
    {
        return ShopTestKit::merchant();
    }

    public static function donor(): User
    {
        return ShopTestKit::donor();
    }

    public static function shop(?User $owner = null, ShopVerificationState $state = ShopVerificationState::Verified): Shop
    {
        return ShopTestKit::shop($owner, $state);
    }

    public static function staff(Shop $shop): User
    {
        $staff = self::merchant();
        ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);

        return $staff;
    }

    public static function owner(Shop $shop): User
    {
        return User::query()->findOrFail($shop->owner_id);
    }

    public static function item(Shop $shop): Item
    {
        return ShopTestKit::item($shop);
    }

    /**
     * @return list<Hook>
     */
    public static function availableUnits(Item $item, int $count = 3): array
    {
        return HookWorld::availableHooks($item, $count);
    }
}
