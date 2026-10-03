<?php

namespace App\Support\Logging;

use Illuminate\Log\Logger;
use Monolog\Logger as Monolog;

/**
 * Log channel tap (config/logging.php): adds the MaskingProcessor to the channel.
 */
final class MaskSensitiveData
{
    public function __invoke(Logger $logger): void
    {
        $monolog = $logger->getLogger();

        if ($monolog instanceof Monolog) {
            $monolog->pushProcessor(new MaskingProcessor);
        }
    }
}
