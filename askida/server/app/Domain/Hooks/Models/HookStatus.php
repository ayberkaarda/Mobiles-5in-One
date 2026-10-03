<?php

namespace App\Domain\Hooks\Models;

enum HookStatus: string
{
    case Available = 'AVAILABLE';
    case Reserved = 'RESERVED';
    case Redeemed = 'REDEEMED';
    case Expired = 'EXPIRED';
}
