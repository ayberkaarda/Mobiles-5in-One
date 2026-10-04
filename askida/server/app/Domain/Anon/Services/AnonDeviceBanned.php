<?php

namespace App\Domain\Anon\Services;

use RuntimeException;

/**
 * The attesting device is banned; no token is issued.
 */
final class AnonDeviceBanned extends RuntimeException {}
