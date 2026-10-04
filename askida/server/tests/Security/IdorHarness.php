<?php

namespace Tests\Security;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Models\User;
use Closure;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Assert;
use Tests\TestCase;

/**
 * Reusable checks that one caller never reaches another caller's resource
 * (security checklist item 4).
 *
 * Convention (ADR): a resource the caller cannot know exists answers 404 `not_found`,
 * exactly like a missing id; 403 `forbidden` only when the caller can legitimately
 * know it exists but lacks the ability or role.
 */
final class IdorHarness
{
    public function __construct(private readonly TestCase $test) {}

    /**
     * A device token for the user, issued the way the login endpoints issue it.
     */
    public static function bearer(User $user, string $device = 'idor-device'): string
    {
        return app(DeviceTokenIssuer::class)->issue($user, $device, 'android')->plainTextToken;
    }

    /**
     * Sends a JSON request with the token, forgetting any user the guards resolved for
     * an earlier request of the same test.
     *
     * @param  array<string, mixed>  $payload
     */
    public function call(string $method, string $uri, ?string $token, array $payload = []): TestResponse
    {
        app('auth')->forgetGuards();

        $test = $this->test;
        $headers = $token === null ? [] : ['Authorization' => 'Bearer '.$token];

        return $test->json($method, $uri, $payload, $headers);
    }

    /**
     * Route-level check: the owner's token reaches the resource, the intruder's token
     * gets the expected problem.
     *
     * @param  Closure(User): Model  $makeResource  creates the resource owned by the given user
     * @param  array<string, mixed>  $payload
     */
    public function assertRouteIsolated(
        string $method,
        string $uriTemplate,
        Closure $makeResource,
        User $owner,
        User $intruder,
        int $status = 404,
        array $payload = [],
    ): void {
        $resource = $makeResource($owner);
        $key = $resource->getKey();
        $uri = (string) preg_replace('/\{[^}]+\}/', is_scalar($key) ? (string) $key : '', $uriTemplate, 1);

        $allowed = $this->call($method, $uri, self::bearer($owner, 'owner-device'), $payload);
        Assert::assertLessThan(400, $allowed->status(), "The owner must reach {$method} {$uri}.");

        self::assertProblem($this->call($method, $uri, self::bearer($intruder, 'intruder-device'), $payload), $status);
    }

    /**
     * Policy-level check for actions whose endpoints arrive in later phases.
     *
     * @param  array<int, mixed>|mixed  $arguments
     */
    public static function assertPolicyDenies(User|AnonDevice|null $actor, string $ability, mixed $arguments, int $status): void
    {
        $response = Gate::forUser($actor)->inspect($ability, $arguments);

        Assert::assertFalse($response->allowed(), "{$ability} must be denied.");
        Assert::assertSame($status, $response->status(), "{$ability} must be denied with {$status}.");
        Assert::assertSame($status === 404 ? 'not_found' : 'forbidden', $response->code());
    }

    /**
     * @param  array<int, mixed>|mixed  $arguments
     */
    public static function assertPolicyAllows(User|AnonDevice|null $actor, string $ability, mixed $arguments): void
    {
        Assert::assertTrue(Gate::forUser($actor)->inspect($ability, $arguments)->allowed(), "{$ability} must be allowed.");
    }

    public static function assertProblem(TestResponse $response, int $status): void
    {
        $response->assertStatus($status);

        $code = match ($status) {
            401 => 'auth.unauthenticated',
            403 => 'forbidden',
            404 => 'not_found',
            default => null,
        };

        Assert::assertSame('application/problem+json', $response->headers->get('Content-Type'));

        if ($code !== null) {
            Assert::assertSame($code, $response->json('code'));
        }
    }
}
