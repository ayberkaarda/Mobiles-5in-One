<?php

namespace App\Domain\Auth\Passwords;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Breached password lookup over the k-anonymity range API: only the first five hex
 * characters of the SHA-1 hash leave the server.
 *
 * Fails open: when the service is disabled, slow or unreachable the password is treated
 * as not breached and a warning is logged, so sign-up never depends on a third party.
 */
class BreachedPasswordChecker
{
    public function isBreached(string $password): bool
    {
        if (! (bool) config('services.breached_passwords.enabled', true)) {
            return false;
        }

        $hash = strtoupper(sha1($password));
        $prefix = substr($hash, 0, 5);
        $suffix = substr($hash, 5);

        try {
            $response = Http::timeout((int) config('services.breached_passwords.timeout_seconds', 3))
                ->withHeaders(['Add-Padding' => 'true'])
                ->get((string) config('services.breached_passwords.url').$prefix);
            $body = $response->successful() ? $response->body() : null;
        } catch (Throwable) {
            $body = null;
        }

        if ($body === null) {
            Log::warning('Breached password check unavailable; the password was accepted without it.');

            return false;
        }

        foreach (preg_split('/\R/', $body) ?: [] as $line) {
            $parts = explode(':', trim($line), 2);

            if (count($parts) === 2 && hash_equals($suffix, strtoupper($parts[0])) && (int) $parts[1] > 0) {
                return true;
            }
        }

        return false;
    }
}
