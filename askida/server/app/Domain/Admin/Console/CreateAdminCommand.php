<?php

namespace App\Domain\Admin\Console;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Auth\Enums\UserKind;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

/**
 * Bootstraps a panel account: creates the user with a random temporary password, prints
 * that password once on the console (it is never logged or stored in clear) and assigns
 * the role. The account has no TOTP secret, so its first sign-in is forced into TOTP
 * setup before any panel page opens. An existing e-mail is refused unchanged.
 */
final class CreateAdminCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'admin:create
        {email : E-mail address of the new panel account}
        {--role=admin : admin, moderator or finance}
        {--name=Askida Yönetim : Display name}';

    /**
     * @var string
     */
    protected $description = 'Create an admin panel account with a one-time temporary password';

    public function handle(): int
    {
        $email = Str::lower(trim((string) $this->argument('email')));
        $role = AdminRole::tryFrom(Str::lower(trim((string) $this->option('role'))));
        $name = trim((string) $this->option('name'));

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $this->error('The e-mail address is not valid.');

            return self::FAILURE;
        }

        if (! $role instanceof AdminRole) {
            $this->error('The role must be one of: '.implode(', ', array_column(AdminRole::cases(), 'value')).'.');

            return self::FAILURE;
        }

        if ($name === '' || mb_strlen($name) > 120) {
            $this->error('The name must be 1 to 120 characters.');

            return self::FAILURE;
        }

        if (Role::query()->where('name', $role->value)->where('guard_name', AdminRole::GUARD)->doesntExist()) {
            $this->error('Panel roles are missing. Run: php artisan db:seed --class=RolesSeeder');

            return self::FAILURE;
        }

        if (User::query()->where('email', $email)->exists()) {
            $this->error('An account with this e-mail already exists. Nothing was changed.');

            return self::FAILURE;
        }

        $password = Str::password(24);

        $user = DB::transaction(function () use ($email, $name, $password, $role): User {
            $user = new User;
            // The users table only knows donor and merchant kinds; panel power comes
            // from the role alone, and admin gates ignore anything a mobile token carries.
            $user->forceFill([
                'name' => $name,
                'email' => $email,
                'password' => $password,
                'kind' => UserKind::Donor,
                'email_verified_at' => now(),
            ])->save();

            $user->assignRole($role->value);
            app(PermissionRegistrar::class)->forgetCachedPermissions();

            AdminAudit::log('admin.user_created', null, $user, ['role' => $role->value]);

            return $user;
        });

        $this->info('Panel account created (role: '.$role->value.', id: '.$user->id.').');
        $this->line('Temporary password (shown once, not stored in clear): '.$password);
        $this->line('At first sign-in the account must set up an authenticator app (TOTP).');

        return self::SUCCESS;
    }
}
