<?php

namespace App\Models;

use App\Domain\Admin\PanelAccess;
use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Enums\UserKind;
use Database\Factories\UserFactory;
use Filament\Models\Contracts\FilamentUser;
use Filament\Panel;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\HasApiTokens;
use Spatie\Permission\Traits\HasRoles;

/**
 * Donor or merchant account. Recipients never have a row here. Admin panel staff are
 * accounts holding an admin role; they also carry the TOTP columns.
 *
 * Primary keys are UUIDv7 (HasUuids issues time-ordered version 7 identifiers).
 * Email verification uses a one-time code sent by mail instead of a signed link.
 *
 * @property string $id
 * @property string $email
 * @property Carbon|null $email_verified_at
 * @property string|null $password
 * @property string|null $apple_sub
 * @property string|null $google_sub
 * @property string $name
 * @property UserKind $kind
 * @property Carbon|null $deactivated_at
 * @property string|null $two_factor_secret
 * @property list<string>|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 * @property int|null $two_factor_last_used_step
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'email', 'password', 'kind'])]
#[Hidden(['password', 'apple_sub', 'google_sub', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_last_used_step'])]
class User extends Authenticatable implements FilamentUser, MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, HasUuids, Notifiable;

    /**
     * API tokens only: there is no remember-me cookie.
     *
     * @var string
     */
    protected $rememberTokenName = '';

    /**
     * Timestamps are written with their UTC offset so timestamptz columns store the
     * right instant whatever the database session time zone is.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'deactivated_at' => 'datetime',
            'password' => 'hashed',
            'kind' => UserKind::class,
            'two_factor_secret' => 'encrypted',
            'two_factor_recovery_codes' => 'array',
            'two_factor_confirmed_at' => 'datetime',
            'two_factor_last_used_step' => 'integer',
        ];
    }

    /**
     * Admin panel entry: an admin, moderator or finance role on an active account, in a
     * panel session (never through a personal access token).
     */
    public function canAccessPanel(Panel $panel): bool
    {
        return PanelAccess::allows($this);
    }

    public function isDeactivated(): bool
    {
        return $this->deactivated_at !== null;
    }

    public function hasVerifiedEmail(): bool
    {
        return $this->email_verified_at !== null;
    }

    public function markEmailAsVerified(): bool
    {
        return $this->forceFill(['email_verified_at' => $this->freshTimestamp()])->save();
    }

    public function sendEmailVerificationNotification(): void
    {
        app(OneTimeCodeService::class)->sendEmailVerification($this);
    }

    public function getEmailForVerification(): string
    {
        return $this->email;
    }
}
