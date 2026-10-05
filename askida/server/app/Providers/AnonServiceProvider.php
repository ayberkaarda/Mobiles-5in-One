<?php

namespace App\Providers;

use App\Domain\Anon\Attestation\DeviceCheckVerifier;
use App\Domain\Anon\Attestation\FakeAttestationVerifier;
use App\Domain\Anon\Attestation\PlatformAttestationVerifier;
use App\Domain\Anon\Attestation\PlayIntegrityVerifier;
use App\Domain\Anon\Auth\AnonTokenRule;
use App\Domain\Anon\Auth\RequestPrincipal;
use App\Domain\Anon\Contracts\AttestationVerifier;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AccessTokenRule;
use App\Domain\Hooks\Codes\HookCodeHasher;
use App\Domain\Hooks\Events\HookRedeemed;
use App\Domain\Hooks\Events\HooksIssued;
use App\Domain\Hooks\Listeners\NotifyDonorRedeemed;
use App\Domain\Hooks\Listeners\NotifyShopNewHooks;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\Transports\LogPushTransport;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;
use RuntimeException;

/**
 * Anonymous devices, the hook engine and push wiring:
 * - attestation verifier by ATTESTATION_DRIVER (`fake` in local/testing only, `real`);
 * - the HOOK_CODE_PEPPER hasher and the push transport by PUSH_DRIVER;
 * - configuration guards: outside `local` and `testing` the application refuses to boot
 *   with an empty pepper, the fake attestation or the log push transport;
 * - the bearer token rule for anon device tokens (user tokens keep AccessTokenRule);
 * - limiters `anon-attest`, `hooks-reserve`, `redeem` (security item 5);
 * - listeners of the hook events (pushes).
 */
class AnonServiceProvider extends ServiceProvider
{
    /**
     * Environments where simulated adapters and a missing pepper are tolerated.
     */
    public const LOCAL_ENVIRONMENTS = ['local', 'testing'];

    public function register(): void
    {
        $this->app->singleton(FakeAttestationVerifier::class);

        $this->app->bind(PlayIntegrityVerifier::class, static fn (Application $app): PlayIntegrityVerifier => new PlayIntegrityVerifier(
            $app->make(Http::class),
            $app->make(Cache::class),
            (array) config('askida.attestation.play_integrity', []),
            (int) config('askida.attestation.http_timeout_seconds', 5),
            (int) config('askida.attestation.max_token_age_seconds', 600),
        ));

        $this->app->bind(DeviceCheckVerifier::class, static fn (Application $app): DeviceCheckVerifier => new DeviceCheckVerifier(
            $app->make(Http::class),
            (array) config('askida.attestation.device_check', []),
            (int) config('askida.attestation.http_timeout_seconds', 5),
        ));

        $this->app->bind(AttestationVerifier::class, static fn (Application $app): AttestationVerifier => match (config('askida.attestation.driver')) {
            'fake' => self::localOnly($app, 'ATTESTATION_DRIVER=fake', $app->make(FakeAttestationVerifier::class)),
            'real' => $app->make(PlatformAttestationVerifier::class),
            default => throw new RuntimeException('ATTESTATION_DRIVER must be "fake" or "real".'),
        });

        $this->app->bind(HookCodeHasher::class, static function (): HookCodeHasher {
            $pepper = config('askida.hook_code_pepper');

            return new HookCodeHasher(is_string($pepper) ? $pepper : null);
        });

        $this->app->bind(PushTransport::class, static fn (Application $app): PushTransport => match (config('askida.push.driver')) {
            'log' => self::localOnly($app, 'PUSH_DRIVER=log', new LogPushTransport(Log::channel())),
            default => throw new RuntimeException('No push transport is available for the configured PUSH_DRIVER.'),
        });
    }

    public function boot(): void
    {
        self::guardConfiguration($this->app->environment());

        Sanctum::authenticateAccessTokensUsing(static function (PersonalAccessToken $token, bool $isValid): bool {
            if ($token->tokenable instanceof AnonDevice) {
                $route = request()->route();

                return AnonTokenRule::accepts($token, $route instanceof Route ? $route : null);
            }

            return AccessTokenRule::accepts($token, $isValid);
        });

        $this->registerLimiters();

        Event::listen(HookRedeemed::class, NotifyDonorRedeemed::class);
        Event::listen(HooksIssued::class, NotifyShopNewHooks::class);
    }

    /**
     * Fails the boot of a production-like environment whose configuration would fall
     * back to a simulated adapter or an unkeyed code hash.
     */
    public static function guardConfiguration(string $environment): void
    {
        if (in_array($environment, self::LOCAL_ENVIRONMENTS, true)) {
            return;
        }

        $pepper = HookCodeHasher::requirePepper(config('askida.hook_code_pepper'));

        if (hash_equals(HookCodeHasher::EXAMPLE_PEPPER, trim($pepper))) {
            throw new RuntimeException('HOOK_CODE_PEPPER still holds the .env.example value; set a long random secret.');
        }

        if (config('askida.attestation.driver') !== 'real') {
            throw new RuntimeException('ATTESTATION_DRIVER must be "real" outside local and testing.');
        }

        if (config('askida.push.driver') === 'log') {
            throw new RuntimeException('PUSH_DRIVER=log is refused outside local and testing.');
        }
    }

    /**
     * @template T of object
     *
     * @param  T  $adapter
     * @return T
     */
    private static function localOnly(Application $app, string $setting, object $adapter): object
    {
        if (! in_array($app->environment(), self::LOCAL_ENVIRONMENTS, true)) {
            throw new RuntimeException("{$setting} is refused outside local and testing.");
        }

        return $adapter;
    }

    private function registerLimiters(): void
    {
        $problem = RateLimitServiceProvider::problemResponse(...);

        RateLimiter::for('anon-attest', static function (Request $request) use ($problem): Limit {
            $nonce = $request->input('device_nonce');
            $deviceKey = hash('sha256', (is_string($nonce) ? $nonce : '').'|'.(string) $request->ip());

            return Limit::perDay((int) config('askida.limits.anon_attest_per_day', 3))
                ->by('anon-attest:'.$deviceKey)
                ->response($problem);
        });

        RateLimiter::for('hooks-reserve', static function (Request $request) use ($problem): array {
            $anonId = RequestPrincipal::anonDevice($request)->anon_id ?? '';

            return [
                Limit::perHour((int) config('askida.limits.hooks_reserve_per_hour_anon', 5))
                    ->by('hooks-reserve:anon:'.hash('sha256', $anonId))
                    ->response($problem),
                Limit::perHour((int) config('askida.limits.hooks_reserve_per_hour_ip', 60))
                    ->by('hooks-reserve:ip:'.(string) $request->ip())
                    ->response($problem),
            ];
        });

        // 30 per minute per shop for its members. A caller that is not a member of the
        // shop in the path gets a bucket of its own, so outsiders cannot use up a shop's
        // budget (their requests end in 404 anyway).
        RateLimiter::for('redeem', static function (Request $request) use ($problem): Limit {
            $shop = $request->route('shop');
            // Lower-cased: the router and PostgreSQL accept a UUID in any letter case, and
            // each spelling must not open a bucket of its own.
            $shopId = strtolower($shop instanceof Shop ? $shop->id : (is_string($shop) ? $shop : ''));
            $user = $request->user();
            $member = $user instanceof User && $shopId !== ''
                && ShopMember::query()->where('shop_id', $shopId)->where('user_id', $user->id)->exists();

            $key = $member ? 'shop:'.$shopId : 'outsider:'.($user instanceof User ? $user->id : (string) $request->ip());

            return Limit::perMinute((int) config('askida.limits.redeem_per_minute_shop', 30))
                ->by('redeem:'.$key)
                ->response($problem);
        });
    }
}
