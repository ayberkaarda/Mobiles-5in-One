<?php

namespace App\Domain\Hooks\Services;

use RuntimeException;

/**
 * Units are created only for a paid donation.
 */
final class HookIssuanceRefused extends RuntimeException {}
