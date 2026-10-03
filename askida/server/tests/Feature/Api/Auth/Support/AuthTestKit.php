<?php

namespace Tests\Feature\Api\Auth\Support;

use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\NewAccessToken;
use PHPUnit\Framework\Assert;

/**
 * Shared setup and assertions for the auth feature tests. Passwords are built at run
 * time so no credential-like literal lives in the repository.
 */
final class AuthTestKit
{
    public const DEVICE = 'pixel-8';

    public const KVKK_VERSION = '2026-10';

    /**
     * No real network: every outbound request must be faked by the test.
     */
    public static function boot(bool $cleanBreachService = true): void
    {
        Http::preventStrayRequests();
        Mail::fake();

        // Fast hashing for the suite; the production cost is asserted from the config
        // defaults in tests/Unit/Auth/HashingConfigTest.php.
        config(['hashing.argon.memory' => 1024, 'hashing.argon.time' => 1, 'hashing.argon.threads' => 1]);

        if ($cleanBreachService) {
            self::fakeBreachService('');
        }
    }

    public static function fakeBreachService(string $body): void
    {
        Http::fake(['api.pwnedpasswords.com/*' => Http::response($body, 200)]);
    }

    /**
     * Range API body that lists the given password as breached.
     */
    public static function breachedBody(string $password): string
    {
        $suffix = substr(strtoupper(sha1($password)), 5);

        $other = substr(strtoupper(sha1('unrelated '.$password)), 5);

        return $other.":3\r\n".$suffix.":42\r\n";
    }

    public static function password(): string
    {
        return 'walnut-'.bin2hex(random_bytes(6));
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    public static function registerPayload(array $overrides = []): array
    {
        return array_merge([
            'email' => 'new-'.bin2hex(random_bytes(3)).'@example.test',
            'password' => self::password(),
            'name' => 'Deniz Kaya',
            'kind' => 'donor',
            'device_name' => self::DEVICE,
            'platform' => 'android',
            'kvkk_text_version' => self::KVKK_VERSION,
        ], $overrides);
    }

    /**
     * Clears limiter and lockout state (array cache store in tests).
     */
    public static function resetLimits(): void
    {
        Cache::flush();
    }

    /**
     * The auth manager caches the resolved user between requests of one test; forget it
     * so each request authenticates from its own bearer token.
     */
    public static function forgetGuards(): void
    {
        app('auth')->forgetGuards();
    }

    public static function token(User $user, string $device = self::DEVICE): string
    {
        /** @var NewAccessToken $token */
        $token = app(DeviceTokenIssuer::class)->issue($user, $device, 'ios');

        return $token->plainTextToken;
    }

    /**
     * @param  list<array{field: string, code: string}>|null  $errors
     */
    public static function assertProblem(TestResponse $response, int $status, string $code, ?array $errors = null): void
    {
        $response->assertStatus($status);
        Assert::assertSame('application/problem+json', $response->headers->get('Content-Type'));
        Assert::assertSame($code, $response->json('code'));
        Assert::assertSame('https://askida.app/problems/'.$code, $response->json('type'));

        if ($errors !== null) {
            Assert::assertSame($errors, $response->json('errors'));
        }
    }
}
