<?php

use App\Support\Logging\MaskSensitiveData;
use Monolog\Handler\NullHandler;
use Monolog\Handler\StreamHandler;
use Monolog\Processor\PsrLogMessageProcessor;

/*
|--------------------------------------------------------------------------
| Logging (security checklist item 14)
|--------------------------------------------------------------------------
|
| Default: the stack channel writing to the daily file, level info, 30 files kept.
| Every channel that writes somewhere has the MaskSensitiveData tap, which adds the
| masking processor (e-mails, phones, IBAN and tax numbers, card-like digits, header and
| credential values). The processor is idempotent, so a record that passes through a
| stack and its member channels is masked once in effect.
|
*/

$level = env('LOG_LEVEL', 'info');
$mask = [MaskSensitiveData::class];

return [

    'default' => env('LOG_CHANNEL', 'stack'),

    'deprecations' => [
        'channel' => env('LOG_DEPRECATIONS_CHANNEL', 'null'),
        'trace' => env('LOG_DEPRECATIONS_TRACE', false),
    ],

    'channels' => [

        'stack' => [
            'driver' => 'stack',
            'channels' => explode(',', (string) env('LOG_STACK', 'daily')),
            'ignore_exceptions' => false,
            'tap' => $mask,
        ],

        'single' => [
            'driver' => 'single',
            'path' => storage_path('logs/laravel.log'),
            'level' => $level,
            'replace_placeholders' => true,
            'tap' => $mask,
        ],

        'daily' => [
            'driver' => 'daily',
            'path' => storage_path('logs/laravel.log'),
            'level' => $level,
            'days' => 30,
            'replace_placeholders' => true,
            'tap' => $mask,
        ],

        'stderr' => [
            'driver' => 'monolog',
            'level' => $level,
            'handler' => StreamHandler::class,
            'handler_with' => [
                'stream' => 'php://stderr',
            ],
            'formatter' => env('LOG_STDERR_FORMATTER'),
            'processors' => [PsrLogMessageProcessor::class],
            'tap' => $mask,
        ],

        'syslog' => [
            'driver' => 'syslog',
            'level' => $level,
            'facility' => env('LOG_SYSLOG_FACILITY', LOG_USER),
            'replace_placeholders' => true,
            'tap' => $mask,
        ],

        'errorlog' => [
            'driver' => 'errorlog',
            'level' => $level,
            'replace_placeholders' => true,
            'tap' => $mask,
        ],

        'null' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
        ],

        'emergency' => [
            'path' => storage_path('logs/laravel.log'),
        ],

    ],

];
