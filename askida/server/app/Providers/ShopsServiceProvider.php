<?php

namespace App\Providers;

use App\Domain\Shops\Console\VerifyShopCommand;
use App\Domain\Shops\Documents\DocumentRules;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

/**
 * Shops area: the document presign limiter and the verification command.
 */
class ShopsServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // 10 presigned uploads per shop per day. Applied by DocumentController after
        // authorization (not as route middleware), so only the owner spends the quota.
        RateLimiter::for(DocumentRules::PRESIGN_LIMITER, static function (Request $request): Limit {
            $shop = $request->route('id');

            return Limit::perDay(DocumentRules::PRESIGNS_PER_SHOP_PER_DAY)
                ->by('shop:'.(is_string($shop) ? $shop : 'unknown'));
        });

        if ($this->app->runningInConsole()) {
            $this->commands([VerifyShopCommand::class]);
        }
    }
}
