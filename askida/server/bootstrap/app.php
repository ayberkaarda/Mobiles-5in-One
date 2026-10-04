<?php

use App\Http\Middleware\AdminSessionCookie;
use App\Http\Middleware\EnforceHttps;
use App\Http\Middleware\LimitRequestBody;
use App\Http\Middleware\LogRequest;
use App\Http\Middleware\RequestId;
use App\Http\Middleware\SecurityHeaders;
use App\Support\Problem\Handler;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend([
            RequestId::class,
            LogRequest::class,
            SecurityHeaders::class,
        ]);

        // After TrustProxies, so that isSecure() reflects only trusted forwarded headers.
        $middleware->append([
            EnforceHttps::class,
            LimitRequestBody::class,
            AdminSessionCookie::class,
        ]);

        // There is no "login" route: API guests get the auth.unauthenticated problem
        // whatever their Accept header, web guests go to the admin panel login.
        $middleware->redirectGuestsTo(
            static fn (Request $request): ?string => Handler::isApi($request) ? null : '/admin/login',
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        Handler::register($exceptions);
    })->create();
