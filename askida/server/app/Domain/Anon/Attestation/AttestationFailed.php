<?php

namespace App\Domain\Anon\Attestation;

use RuntimeException;

/**
 * The provider rejected the attestation token, or its verdict does not meet the bar.
 * The message is for logs only and never reaches a response body.
 */
final class AttestationFailed extends RuntimeException {}
