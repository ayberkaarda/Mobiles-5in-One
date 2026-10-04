<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Exceptions\LastAdminProtected;
use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Admin\Services\AdminRoleManager;
use App\Domain\Admin\Services\TwoFactorManager;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Auth\Abilities\AdminRole;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Pages\Auth\Login;
use App\Filament\Resources\UserResource\Pages;
use App\Filament\Support\PanelActor;
use App\Models\User;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Panel staff (matrix: "Manage admin users and roles", admin only): lists accounts that
 * hold an admin, moderator or finance role. Assigning or revoking a role and resetting
 * someone's TOTP each ask for a fresh TOTP code of the acting admin, and none of them
 * may leave the system without an active admin with confirmed TOTP. Accounts are created
 * with `php artisan admin:create`; no action lets one user act as another.
 */
class UserResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = User::class;

    protected static ?string $slug = 'staff';

    protected static ?string $navigationIcon = 'heroicon-o-user-group';

    protected static ?string $navigationGroup = 'Yönetim';

    protected static ?string $modelLabel = 'panel kullanıcısı';

    protected static ?string $pluralModelLabel = 'Panel kullanıcıları';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::ManageRoles->gate(),
            'view' => AdminPermission::ManageRoles->gate(),
        ];
    }

    /**
     * @return Builder<User>
     */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()
            ->whereHas('roles', fn (Builder $roles): Builder => $roles
                ->whereIn('name', array_column(AdminRole::cases(), 'value'))
                ->where('guard_name', AdminRole::GUARD))
            ->with('roles');
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('name')->label('Ad'),
                Tables\Columns\TextColumn::make('email')->label('E-posta')->searchable(),
                Tables\Columns\TextColumn::make('roles.name')->label('Roller')->badge(),
                Tables\Columns\IconColumn::make('two_factor_enabled')->label('TOTP')->boolean()
                    ->state(fn (User $record): bool => $record->two_factor_confirmed_at !== null),
                Tables\Columns\IconColumn::make('active')->label('Etkin')->boolean()
                    ->state(fn (User $record): bool => ! $record->isDeactivated()),
            ])
            ->actions([
                Tables\Actions\Action::make('assignRole')
                    ->label('Rol ver')
                    ->icon('heroicon-o-plus-circle')
                    ->form([self::roleField(), self::freshCodeField()])
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::ManageRoles->gate()))
                    ->action(function (User $record, array $data): void {
                        $actor = self::confirmedActor((string) $data['code']);
                        $changed = app(AdminRoleManager::class)->assign($record, AdminRole::from((string) $data['role']), $actor);

                        Notification::make()->success()->title($changed ? 'Rol verildi.' : 'Kullanıcı bu role zaten sahip.')->send();
                    }),
                Tables\Actions\Action::make('revokeRole')
                    ->label('Rolü geri al')
                    ->icon('heroicon-o-minus-circle')
                    ->color('danger')
                    ->form([self::roleField(), self::freshCodeField()])
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::ManageRoles->gate()))
                    ->action(function (User $record, array $data): void {
                        $actor = self::confirmedActor((string) $data['code']);

                        try {
                            $changed = app(AdminRoleManager::class)->revoke($record, AdminRole::from((string) $data['role']), $actor);
                        } catch (LastAdminProtected) {
                            Notification::make()->danger()->title('Son yönetici rolü geri alınamaz.')
                                ->body('TOTP doğrulaması tamamlanmış en az bir etkin yönetici kalmalıdır.')->send();

                            return;
                        }

                        Notification::make()->success()->title($changed ? 'Rol geri alındı.' : 'Kullanıcı bu role sahip değil.')->send();
                    }),
                Tables\Actions\Action::make('resetTwoFactor')
                    ->label('TOTP sıfırla')
                    ->icon('heroicon-o-key')
                    ->color('warning')
                    ->modalDescription('Kullanıcı bir sonraki girişte doğrulayıcı uygulamayı yeniden kurmak zorunda kalır.')
                    ->form([self::freshCodeField()])
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::ManageRoles->gate()))
                    ->action(function (User $record, array $data): void {
                        $actor = self::confirmedActor((string) $data['code']);

                        try {
                            app(AdminRoleManager::class)->resetTwoFactor($record, $actor);
                        } catch (LastAdminProtected) {
                            Notification::make()->danger()->title('Son yöneticinin TOTP kaydı sıfırlanamaz.')->send();

                            return;
                        }

                        Notification::make()->success()->title('TOTP sıfırlandı.')->send();
                    }),
            ])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListUsers::route('/'),
        ];
    }

    /**
     * The acting admin, after checking a fresh TOTP code (matrix note: role changes need
     * a fresh TOTP prompt). Recovery codes do not count here.
     */
    private static function confirmedActor(string $code): User
    {
        $actor = PanelActor::user();
        $limit = Login::limitFor($actor);

        if (RateLimiter::tooManyAttempts($limit->key, $limit->maxAttempts)) {
            throw ValidationException::withMessages(['mountedTableActionsData.0.code' => 'Çok fazla hatalı deneme. Biraz sonra yeniden deneyin.']);
        }

        if (! app(TwoFactorManager::class)->verifyFreshCode($actor, $code)) {
            RateLimiter::hit($limit->key, $limit->decaySeconds);
            AdminAudit::log('admin.totp_failed', $actor, $actor);

            throw ValidationException::withMessages(['mountedTableActionsData.0.code' => 'Kod doğrulanamadı.']);
        }

        return $actor;
    }

    private static function roleField(): Select
    {
        return Select::make('role')->label('Rol')->required()->options([
            AdminRole::Admin->value => 'Yönetici (admin)',
            AdminRole::Moderator->value => 'Moderatör',
            AdminRole::Finance->value => 'Finans',
        ]);
    }

    private static function freshCodeField(): TextInput
    {
        return TextInput::make('code')->label('Güncel TOTP kodunuz')->required()->length(6)->autocomplete('one-time-code');
    }
}
