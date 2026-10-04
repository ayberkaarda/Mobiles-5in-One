<?php

namespace Tests\Unit\Support;

use Closure;

/**
 * Runs a callback with environment values overridden, so config files can be evaluated
 * for another environment (for example production) inside a test.
 */
final class TemporaryEnv
{
    /**
     * @template T
     *
     * @param  array<string, string|null>  $values  null removes the variable
     * @param  Closure(): T  $callback
     * @return T
     */
    public static function run(array $values, Closure $callback): mixed
    {
        $saved = [];

        foreach ($values as $name => $value) {
            $saved[$name] = [$_SERVER[$name] ?? null, $_ENV[$name] ?? null, getenv($name)];

            if ($value === null) {
                unset($_SERVER[$name], $_ENV[$name]);
                putenv($name);
            } else {
                $_SERVER[$name] = $_ENV[$name] = $value;
                putenv($name.'='.$value);
            }
        }

        try {
            return $callback();
        } finally {
            foreach ($saved as $name => [$server, $env, $process]) {
                if ($server === null) {
                    unset($_SERVER[$name]);
                } else {
                    $_SERVER[$name] = $server;
                }

                if ($env === null) {
                    unset($_ENV[$name]);
                } else {
                    $_ENV[$name] = $env;
                }

                putenv($process === false ? $name : $name.'='.$process);
            }
        }
    }
}
