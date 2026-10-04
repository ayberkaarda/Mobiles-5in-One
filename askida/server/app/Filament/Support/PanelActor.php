<?php

namespace App\Filament\Support;

use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Support\Facades\Gate;

/**
 * The signed-in panel user and the admin gate checks of panel actions.
 */
final class PanelActor
{
    public static function user(): User
    {
        $user = Filament::auth()->user();
        abort_unless($user instanceof User, 403);

        return $user;
    }

    public static function allows(string $gate): bool
    {
        $user = Filament::auth()->user();

        return $user instanceof User && Gate::forUser($user)->allows($gate);
    }
}
