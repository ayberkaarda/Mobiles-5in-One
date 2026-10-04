<?php

namespace App\Models;

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Enums\UserKind;
use Database\Factories\UserFactory;
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
 * Donor or merchant account. Recipients never have a row here.
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
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'email', 'password', 'kind'])]
#[Hidden(['password', 'apple_sub', 'google_sub'])]
class User extends Authenticatable implements MustVerifyEmail
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
        ];
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
