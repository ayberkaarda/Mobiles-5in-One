<?php

namespace App\Providers;

use App\Domain\Auth\Abilities\AccessTokenRule;
use App\Domain\Auth\Abilities\AdminAccess;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Policies\DonationPolicy;
use App\Policies\HookPolicy;
use App\Policies\ItemPolicy;
use App\Policies\PayoutPolicy;
use App\Policies\ShopDocumentPolicy;
use App\Policies\ShopPolicy;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Laravel\Sanctum\Http\Middleware\CheckForAnyAbility;
use Laravel\Sanctum\Sanctum;

/**
 * Policies, admin gates and token abilities (security checklist items 3 and 4). The
 * single source for every rule is docs/security/authorization-matrix.md.
 *
 * - API policies decide for donor, merchant (owner or staff via shop_members) and anon
 *   actors. They never consult admin roles and have no allow-all `before` hook, so no
 *   role bypasses ownership of donor data or anonymity.
 * - Admin gates decide for the panel roles (moderator, finance, admin), one gate per
 *   matrix operation, through AdminAccess.
 */
class AuthServiceProvider extends ServiceProvider
{
    /**
     * @var array<class-string, class-string>
     */
    public const POLICIES = [
        Shop::class => ShopPolicy::class,
        Item::class => ItemPolicy::class,
        Donation::class => DonationPolicy::class,
        Hook::class => HookPolicy::class,
        Payout::class => PayoutPolicy::class,
        ShopDocument::class => ShopDocumentPolicy::class,
    ];

    /**
     * Operations that no role may perform (matrix section 4). They are gates that always
     * deny, so a later panel action that asks for them is refused instead of undefined.
     */
    public const FORBIDDEN_FOR_EVERYONE = ['impersonate'];

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        foreach (self::POLICIES as $model => $policy) {
            Gate::policy($model, $policy);
        }

        foreach (AdminPermission::cases() as $permission) {
            Gate::define(
                $permission->gate(),
                static fn (mixed $user = null): bool => AdminAccess::allows($user, $permission),
            );
        }

        foreach (self::FORBIDDEN_FOR_EVERYONE as $ability) {
            Gate::define($ability, static fn (mixed $user = null): bool => false);
        }

        Sanctum::authenticateAccessTokensUsing(AccessTokenRule::accepts(...));

        $router = $this->app->make(Router::class);
        $router->aliasMiddleware('abilities', CheckAbilities::class);
        $router->aliasMiddleware('ability', CheckForAnyAbility::class);
    }
}
