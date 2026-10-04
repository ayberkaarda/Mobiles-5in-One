<?php

use Askida\PHPStan\Rules\NoInterpolatedRawSqlRule;

/*
 * Project PHPStan rules. Included from phpstan.neon as a PHP config file, so the rule
 * classes (which live outside the composer autoload map) are loaded before PHPStan
 * builds its container.
 */

require_once __DIR__.'/Rules/NoInterpolatedRawSqlRule.php';

return [
    'rules' => [
        // Security checklist item 15: no interpolated or concatenated SQL in raw query methods.
        NoInterpolatedRawSqlRule::class,
    ],
];
