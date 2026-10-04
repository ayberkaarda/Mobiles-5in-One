<?php

namespace App\Domain\Anon\Attestation;

use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\DevicePlatform;
use Closure;
use Throwable;

/**
 * Simulated attestation for local development and tests. AnonServiceProvider binds it
 * only in the `local` and `testing` environments; every other environment refuses to
 * boot with it.
 *
 * Deterministic default: a token starting with `reject` fails, a token starting with
 * `unavailable` simulates an unreachable provider, any other non-empty token passes
 * with the verdict `valid`. Tests can script answers instead (queue() or using()).
 */
final class FakeAttestationVerifier implements AttestationVerifier
{
    /** @var list<AttestationVerdict|Throwable> */
    private array $queue = [];

    /** @var (Closure(DevicePlatform, string, string): AttestationVerdict)|null */
    private ?Closure $handler = null;

    /** @var list<array{platform: DevicePlatform, nonce: string}> */
    private array $calls = [];

    public function verify(DevicePlatform $platform, string $token, string $deviceNonce): AttestationVerdict
    {
        $this->calls[] = ['platform' => $platform, 'nonce' => $deviceNonce];

        if ($this->queue !== []) {
            $next = array_shift($this->queue);

            if ($next instanceof Throwable) {
                throw $next;
            }

            return $next;
        }

        if ($this->handler !== null) {
            return ($this->handler)($platform, $token, $deviceNonce);
        }

        return match (true) {
            $token === '' || str_starts_with($token, 'reject') => throw new AttestationFailed('Simulated rejection.'),
            str_starts_with($token, 'unavailable') => throw new AttestationUnavailable('Simulated outage.'),
            default => new AttestationVerdict($platform),
        };
    }

    /**
     * Answers the next calls in order, before the handler or the default rule.
     */
    public function queue(AttestationVerdict|Throwable ...$answers): self
    {
        array_push($this->queue, ...array_values($answers));

        return $this;
    }

    /**
     * @param  Closure(DevicePlatform, string, string): AttestationVerdict  $handler
     */
    public function using(Closure $handler): self
    {
        $this->handler = $handler;

        return $this;
    }

    /**
     * Calls received so far (platform and nonce only; tokens are not kept).
     *
     * @return list<array{platform: DevicePlatform, nonce: string}>
     */
    public function calls(): array
    {
        return $this->calls;
    }
}
