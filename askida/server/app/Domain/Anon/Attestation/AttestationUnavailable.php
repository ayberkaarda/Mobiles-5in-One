<?php

namespace App\Domain\Anon\Attestation;

use RuntimeException;

/**
 * The provider could not give a verdict (not configured, unreachable, unexpected
 * answer). Attestation fails closed: no verdict means no anon token.
 */
final class AttestationUnavailable extends RuntimeException {}
