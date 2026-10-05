<?php

namespace App\Domain\Cost\Contracts;

/**
 * Marker for a mailable that may be dropped once the daily e-mail cap is reached. Every
 * mailable without it is critical and always goes out. No such mailable exists today.
 */
interface NonCriticalMail {}
