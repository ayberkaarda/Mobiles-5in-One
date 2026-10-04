<?php

namespace App\Providers;

use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Impact\DbCountersReader;
use App\Support\Web\ResponseCache\CacheResponse;
use App\Support\Web\ResponseCache\PageCache;
use App\Support\Web\ZeroCountersReader;
use Illuminate\Routing\Router;
use Illuminate\Support\ServiceProvider;

/**
 * Public web (Blade SSR): the page cache middleware, the counters reader and the
 * registrations of the web areas. Each area appends only inside its own region below.
 */
class WebServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(PageCache::class);

        // Default reader (all counts zero) until the impact area's binding below replaces it.
        $this->app->bind(CountersReader::class, ZeroCountersReader::class);

        // region impact register (append only)
        $this->app->bind(CountersReader::class, DbCountersReader::class);
        // endregion impact register

        // region directory register (append only)
        // endregion directory register

        // region content register (append only)
        // endregion content register

        // region pages register (append only)
        // endregion pages register
    }

    public function boot(): void
    {
        /** @var Router $router */
        $router = $this->app->make('router');
        $router->aliasMiddleware(CacheResponse::ALIAS, CacheResponse::class);

        // region impact boot (append only)
        // endregion impact boot

        // region directory boot (append only)
        // endregion directory boot

        // region content boot (append only)
        // endregion content boot

        // region pages boot (append only)
        // endregion pages boot
    }
}
