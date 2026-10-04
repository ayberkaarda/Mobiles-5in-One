<?php

namespace App\Filament\Concerns;

use Filament\Facades\Filament;
use Illuminate\Auth\Access\Response;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;

/**
 * Panel resources decide with the admin gates of the authorization matrix (section 4),
 * never with the model policies: those describe the mobile API and deny panel sessions.
 *
 * Each resource lists which gate allows which Filament action (viewAny, view, create,
 * update, delete, ...). Any action that is not listed is denied, so a page or bulk
 * action added later without a decision stays closed.
 */
trait GatedByAdminAbilities
{
    /**
     * @return array<string, string> Filament action => admin gate
     */
    abstract public static function abilityGates(): array;

    public static function can(string $action, ?Model $record = null): bool
    {
        $gate = static::abilityGates()[$action] ?? null;

        return $gate !== null && Gate::forUser(Filament::auth()->user())->allows($gate);
    }

    public static function authorize(string $action, ?Model $record = null): ?Response
    {
        return static::can($action, $record) ? Response::allow() : Response::deny();
    }
}
