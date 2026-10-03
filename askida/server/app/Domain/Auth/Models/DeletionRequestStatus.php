<?php

namespace App\Domain\Auth\Models;

enum DeletionRequestStatus: string
{
    case Pending = 'pending';
    case Completed = 'completed';
    case Cancelled = 'cancelled';
}
