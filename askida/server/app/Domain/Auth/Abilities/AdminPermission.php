<?php

namespace App\Domain\Auth\Abilities;

/**
 * Admin panel permissions (spatie/laravel-permission), one per operation of the
 * authorization matrix section 4. Names use dots so that they can never collide with
 * a gate or policy ability name.
 *
 * There is deliberately no permission to edit a hook by hand, to impersonate a user or
 * to read a recipient identity: those operations do not exist for any role.
 */
enum AdminPermission: string
{
    case ReviewShops = 'shops.review';
    case VerifyShops = 'shops.verify';
    case ViewDocuments = 'documents.view';
    case SuspendShops = 'shops.suspend';
    case BanAnonDevices = 'anon_devices.ban';
    case ViewDonations = 'donations.view';
    case ViewPayouts = 'payouts.view';
    case HoldPayouts = 'payouts.hold';
    case RefundPayments = 'payments.refund';
    case RevealShopFinancials = 'shops.reveal_financials';
    case ManageRoles = 'roles.manage';
    case ViewActivityLog = 'activity_log.view';
    case ViewHorizon = 'horizon.view';

    /**
     * The gate that checks this permission.
     */
    public function gate(): string
    {
        return match ($this) {
            self::ReviewShops => 'review-shops',
            self::VerifyShops => 'manage-shops',
            self::ViewDocuments => 'view-documents',
            self::SuspendShops => 'suspend-shops',
            self::BanAnonDevices => 'ban-anon-devices',
            self::ViewDonations => 'view-donations',
            self::ViewPayouts => 'view-payouts',
            self::HoldPayouts => 'manage-payouts',
            self::RefundPayments => 'refund-payments',
            self::RevealShopFinancials => 'reveal-shop-financials',
            self::ManageRoles => 'admin',
            self::ViewActivityLog => 'view-activity-log',
            self::ViewHorizon => 'view-horizon',
        };
    }
}
