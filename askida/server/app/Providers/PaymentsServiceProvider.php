<?php

namespace App\Providers;

use App\Domain\Payments\Console\ReconcileCommand;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Listeners\OnShopRejectedRefund;
use App\Domain\Payments\Services\CommissionCalculator;
use App\Domain\Shops\Events\ShopRejected;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use InvalidArgumentException;
use RuntimeException;

/**
 * Payments area: binds the gateway selected by PAYMENT_PROVIDER and the commission
 * calculator. The fake gateway is refused in production-like environments.
 *
 * Gateway classes are resolved lazily by name, so the binding compiles and boots even
 * where an implementation is not present.
 */
class PaymentsServiceProvider extends ServiceProvider
{
    /**
     * Provider name to gateway class.
     *
     * @var array<string, class-string<PaymentGateway>|string>
     */
    public const GATEWAYS = [
        'iyzico' => 'App\\Domain\\Payments\\Gateways\\IyzicoGateway',
        'fake' => 'App\\Domain\\Payments\\Gateways\\FakeGateway',
    ];

    /**
     * Environments in which the fake gateway must never run.
     *
     * @var list<string>
     */
    public const FAKE_FORBIDDEN_IN = ['production', 'staging'];

    public function register(): void
    {
        $this->app->singleton(CommissionCalculator::class, static fn (): CommissionCalculator => new CommissionCalculator(
            (int) config('payments.commission_bps'),
        ));

        $this->app->bind(PaymentGateway::class, static function (Application $app): PaymentGateway {
            $provider = config('payments.provider');
            $class = is_string($provider) ? (self::GATEWAYS[$provider] ?? null) : null;

            if ($class === null) {
                throw new InvalidArgumentException('Unknown payment provider (expected iyzico or fake).');
            }

            $gateway = $app->make($class);

            if (! $gateway instanceof PaymentGateway) {
                throw new RuntimeException('The configured payment gateway does not implement the contract.');
            }

            return $gateway;
        });
    }

    public function boot(): void
    {
        if (config('payments.provider') === 'fake' && $this->app->environment(self::FAKE_FORBIDDEN_IN)) {
            throw new RuntimeException('The fake payment gateway is not allowed in production-like environments.');
        }

        // Rate limiters donations-create and pay-callback are added here by the payments
        // area; the webhooks limiter is owned by the webhook area.

        // region webhooks (webhook limiter, reconciliation command, refund listener)
        RateLimiter::for('webhooks', static fn (Request $request): Limit => Limit::perMinute(120)
            ->by('webhooks:'.(string) $request->ip())
            ->response(RateLimitServiceProvider::problemResponse(...)));

        Event::listen(ShopRejected::class, OnShopRejectedRefund::class);

        if ($this->app->runningInConsole()) {
            $this->commands([ReconcileCommand::class]);
        }
        // endregion webhooks
    }
}
