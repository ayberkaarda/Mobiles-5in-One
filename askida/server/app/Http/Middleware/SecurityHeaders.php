<?php

namespace App\Http\Middleware;

use Bepsvpt\SecureHeaders\Builders\ContentSecurityPolicyBuilder;
use Bepsvpt\SecureHeaders\SecureHeaders;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Vite;
use Symfony\Component\HttpFoundation\Response;

/**
 * Security checklist item 9: adds the security headers from config/secure-headers.php to
 * every response, picks the CSP profile by route class and creates the per-request nonce
 * that Blade reads through `@nonce` (and Vite/Livewire through Vite::cspNonce()).
 */
class SecurityHeaders
{
    public const PROFILE_PUBLIC = 'public';

    public const PROFILE_ADMIN = 'admin';

    public const PROFILE_PAY = 'pay';

    public const PROFILE_API = 'api';

    public function handle(Request $request, Closure $next): Response
    {
        $profile = self::profileFor($request);
        $nonce = null;

        if ($profile === self::PROFILE_PUBLIC || $profile === self::PROFILE_PAY) {
            $nonce = rtrim(base64_encode(random_bytes(18)), '=');
            Vite::useCspNonce($nonce);
        }

        /** @var Response $response */
        $response = $next($request);

        /** @var array<string, mixed> $config */
        $config = (array) config('secure-headers', []);

        foreach ($this->baseHeaders($config, $request) as $name => $value) {
            $response->headers->set($name, $value);
        }

        $response->headers->set('Content-Security-Policy', $this->csp($config, $profile, $nonce));
        $response->headers->remove('X-Powered-By');

        if (! headers_sent()) {
            header_remove('X-Powered-By');
        }

        if ($profile === self::PROFILE_API) {
            $response->headers->set('Cache-Control', 'no-store');
        }

        return $response;
    }

    public static function profileFor(Request $request): string
    {
        return match (true) {
            $request->is('api', 'api/*') => self::PROFILE_API,
            $request->is('admin', 'admin/*') => self::PROFILE_ADMIN,
            $request->is('pay', 'pay/*') => self::PROFILE_PAY,
            default => self::PROFILE_PUBLIC,
        };
    }

    /**
     * Every header except the CSP, built by the package from the shared config.
     *
     * @param  array<string, mixed>  $config
     * @return array<string, string>
     */
    private function baseHeaders(array $config, Request $request): array
    {
        $hsts = is_array($config['hsts'] ?? null) ? $config['hsts'] : [];
        $hsts['enable'] = ($hsts['enable'] ?? false) && ($request->isSecure() || (bool) ($config['hsts_force'] ?? false));

        $config['hsts'] = $hsts;
        $config['csp'] = ['enable' => false];

        return (new SecureHeaders($config))->headers();
    }

    /**
     * @param  array<string, mixed>  $config
     */
    private function csp(array $config, string $profile, ?string $nonce): string
    {
        /** @var array<string, mixed> $policy */
        $policy = is_array($config['csp'] ?? null) ? $config['csp'] : [];
        /** @var array<string, array<string, mixed>> $profiles */
        $profiles = is_array($config['csp_profiles'] ?? null) ? $config['csp_profiles'] : [];

        foreach ($profiles[$profile] ?? [] as $directive => $value) {
            $policy[$directive] = $value;
        }

        foreach ($policy as $directive => $value) {
            if (is_array($value) && array_key_exists('use-nonce', $value)) {
                $useNonce = (bool) $value['use-nonce'];
                unset($value['use-nonce']);

                if ($useNonce && $nonce !== null) {
                    $value['nonces'] = [$nonce];
                }

                $policy[$directive] = $value;
            }
        }

        return (new ContentSecurityPolicyBuilder($policy))->get();
    }
}
