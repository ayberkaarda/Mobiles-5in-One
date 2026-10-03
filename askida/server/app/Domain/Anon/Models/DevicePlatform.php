<?php

namespace App\Domain\Anon\Models;

enum DevicePlatform: string
{
    case Android = 'android';
    case Ios = 'ios';
}
