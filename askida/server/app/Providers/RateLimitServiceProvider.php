<?php

namespace App\Providers;

use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * Named rate limiters. Every limiter answers with a `rate_limited` problem and a
 * Retry-After header.
 *
 * Client IPs come only from Request::ip(), which honours X-Forwarded-For solely
 * when the direct peer is a configured trusted proxy.
 */
class RateLimitServiceProvider extends ServiceProvider
{
    public const AUTH_PER_MINUTE = 5;

    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        RateLimiter::for('auth', function (Request $request): array {
            $limits = [
                Limit::perMinute(self::AUTH_PER_MINUTE)
                    ->by('ip:'.(string) $request->ip())
                    ->response(self::problemResponse(...)),
            ];

            $email = $request->input('email');

            if (is_string($email) && trim($email) !== '') {
                $limits[] = Limit::perMinute(self::AUTH_PER_MINUTE)
                    ->by('email:'.hash('sha256', Str::lower(trim($email))))
                    ->response(self::problemResponse(...));
            }

            return $limits;
        });
    }

    /**
     * @param  array<string, int|string>  $headers
     */
    public static function problemResponse(Request $request, array $headers): Response
    {
        return ProblemException::make(
            ProblemCode::RateLimited,
            429,
            headers: array_map(static fn (int|string $value): string => (string) $value, $headers),
        )->render();
    }
}
