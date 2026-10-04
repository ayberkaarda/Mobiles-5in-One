<?php

namespace App\Domain\Auth\Abilities;

/**
 * Admin panel roles. They are assigned to `users` rows through spatie/laravel-permission
 * on the `web` guard (the panel session) and never travel on the mobile API: no API
 * policy reads them, and every admin gate refuses a request authenticated by a personal
 * access token.
 */
enum AdminRole: string
{
    case Moderator = 'moderator';
    case Finance = 'finance';
    case Admin = 'admin';

    public const GUARD = 'web';

    /**
     * Permissions of the role, exactly as in the authorization matrix section 4.
     * Admin gets an explicit list, not a wildcard, so a permission added later is not
     * granted to anyone by accident.
     *
     * @return list<AdminPermission>
     */
    public function permissions(): array
    {
        return match ($this) {
            self::Moderator => [
                AdminPermission::ReviewShops,
                AdminPermission::VerifyShops,
                AdminPermission::ViewDocuments,
                AdminPermission::SuspendShops,
                AdminPermission::BanAnonDevices,
            ],
            self::Finance => [
                AdminPermission::SuspendShops,
                AdminPermission::ViewDonations,
                AdminPermission::ViewPayouts,
                AdminPermission::HoldPayouts,
                AdminPermission::RefundPayments,
                AdminPermission::RevealShopFinancials,
            ],
            self::Admin => AdminPermission::cases(),
        };
    }
}
