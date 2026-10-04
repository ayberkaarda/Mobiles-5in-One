<?php

namespace App\Domain\Anon\Auth;

use App\Domain\Anon\Models\AnonDevice;
use Illuminate\Http\Request;

/**
 * The authenticated principal of a request may be an AnonDevice (anon token) as well
 * as a User; the framework's typed accessor only knows users.
 */
final class RequestPrincipal
{
    public static function anonDevice(Request $request): ?AnonDevice
    {
        $principal = ($request->getUserResolver())();

        return $principal instanceof AnonDevice ? $principal : null;
    }
}
