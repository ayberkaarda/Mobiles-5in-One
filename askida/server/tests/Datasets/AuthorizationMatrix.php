<?php

namespace Tests\Datasets;

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Filament\Resources\AbuseFlagResource;
use App\Filament\Resources\ActivityLogResource;
use App\Filament\Resources\AnonDeviceResource;
use App\Filament\Resources\DonationResource;
use App\Filament\Resources\PaymentMismatchResource;
use App\Filament\Resources\PayoutResource;
use App\Filament\Resources\ShopResource;
use App\Filament\Resources\ShopResource\RelationManagers\DocumentsRelationManager;
use App\Filament\Resources\UserResource;
use App\Policies\DonationPolicy;
use App\Policies\HookPolicy;
use App\Policies\ItemPolicy;
use App\Policies\PayoutPolicy;
use App\Policies\ShopDocumentPolicy;
use App\Policies\ShopPolicy;

/**
 * Mirror of docs/security/authorization-matrix.md (sections 3 and 4) with the check
 * that proves each row. AuthorizationMatrixTest compares this file with the document
 * cell by cell, so the two cannot drift.
 *
 * Row key: "<METHOD> <path>" as written in section 3, or the operation text of section 4.
 * Cells: principal => value exactly as in the document (`Y`, `-`, `own`, `member`).
 * Checks, each one of:
 * - ['policy', PolicyClass, method, args]: args are class strings or the fixture names
 *   'shop', 'item', 'donation', 'hook', 'document';
 * - ['gate', ability];
 * - ['route', route name]: the endpoint exists; its authentication middleware is checked;
 * - ['pending', reason]: the endpoint or principal does not exist yet; the test proves
 *   that it is still absent, so building it forces this row to be upgraded;
 * - ['absent', reason]: the operation must not exist for anyone;
 * - ['panel', ResourceClass, 'viewAny'], ['panel', ResourceClass, 'action', name] or
 *   ['panel', RelationManagerClass, 'relation']: the admin panel screen or action that
 *   carries the row, checked per admin principal by tests/Feature/Admin/MatrixPanelRowsTest.php.
 *
 * @phpstan-type Check array{0: string, 1: string, 2?: string, 3?: list<string>|string}
 * @phpstan-type Row array{section: string, cells: array<string, string>, checks: list<Check>}
 */
final class AuthorizationMatrix
{
    public const API_PRINCIPALS = ['guest', 'donor', 'owner', 'staff', 'anon'];

    public const ADMIN_PRINCIPALS = ['mod', 'fin', 'admin'];

    /**
     * @return array<string, Row>
     */
    public static function rows(): array
    {
        return [
            // 3.1 Identity
            'POST auth/register' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.auth.register']),
            'POST auth/login' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.auth.login']),
            'POST auth/apple' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.auth.apple']),
            'POST auth/google' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.auth.google']),
            'POST auth/logout' => self::api('3.1', '- own own own -', ['route', 'api.v1.auth.logout']),
            'POST auth/verify-email' => self::api('3.1', 'Y Y Y Y -', ['route', 'api.v1.auth.verify-email']),
            'POST auth/forgot' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.auth.forgot']),
            'POST auth/reset' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.auth.reset']),
            'GET me' => self::api('3.1', '- own own own -', ['route', 'api.v1.me.show']),
            'PATCH me' => self::api('3.1', '- own own own -', ['route', 'api.v1.me.update']),
            'DELETE me' => self::api('3.1', '- own own own -', ['route', 'api.v1.me.destroy']),
            'PUT me/push-token' => self::api('3.1', '- own own own -', ['route', 'api.v1.me.push-token']),
            'POST anon/attest' => self::api('3.1', 'Y - - - -', ['route', 'api.v1.anon.attest']),
            'DELETE anon/me' => self::api('3.1', '- - - - own', ['route', 'api.v1.anon.me.destroy']),

            // 3.2 Shops and catalog
            'GET shops' => self::api('3.2', '- Y Y Y Y', ['policy', ShopPolicy::class, 'viewAny', [Shop::class]], ['route', 'api.v1.shops.index']),
            'GET shops/{slug}' => self::api('3.2', '- Y Y Y Y', ['policy', ShopPolicy::class, 'view', ['shop']], ['route', 'api.v1.shops.show']),
            'POST shops' => self::api('3.2', '- - Y - -', ['policy', ShopPolicy::class, 'create', [Shop::class]], ['route', 'api.v1.shops.store']),
            'PATCH shops/{id}' => self::api('3.2', '- - member - -', ['policy', ShopPolicy::class, 'update', ['shop']], ['route', 'api.v1.shops.update']),
            'POST shops/{id}/documents/presign' => self::api('3.2', '- - member - -', ['policy', ShopDocumentPolicy::class, 'create', [ShopDocument::class, 'shop']], ['route', 'api.v1.shops.documents.presign']),
            'POST shops/{id}/items' => self::api('3.2', '- - member - -', ['policy', ItemPolicy::class, 'create', [Item::class, 'shop']], ['route', 'api.v1.shops.items.store']),
            'PATCH shops/{id}/items/{itemId}' => self::api('3.2', '- - member - -', ['policy', ItemPolicy::class, 'update', ['item', 'shop']], ['route', 'api.v1.shops.items.update']),

            // 3.3 Donations
            'POST donations' => self::api('3.3', '- Y - - -', ['policy', DonationPolicy::class, 'create', [Donation::class]]),
            'GET donations' => self::api('3.3', '- own - - -', ['policy', DonationPolicy::class, 'viewAny', [Donation::class]]),
            'GET donations/{id}' => self::api('3.3', '- own - - -', ['policy', DonationPolicy::class, 'view', ['donation']]),

            // 3.4 Reservation and redemption
            'POST hooks/reserve' => self::api('3.4', '- - - - own', ['policy', HookPolicy::class, 'reserve', [Hook::class]], ['route', 'api.v1.hooks.reserve']),
            'POST shops/{id}/redeem' => self::api('3.4', '- - member member -', ['policy', HookPolicy::class, 'redeem', [Hook::class, 'shop']]),
            'GET shops/{id}/redemptions?day=' => self::api('3.4', '- - member member -', ['policy', HookPolicy::class, 'viewRedemptions', [Hook::class, 'shop']]),

            // 3.5 Payouts and impact
            'GET shops/{id}/payouts' => self::api('3.5', '- - member - -', ['policy', PayoutPolicy::class, 'viewAny', [Payout::class, 'shop']]),
            'GET impact?il=&ilce=' => self::api('3.5', 'Y Y Y Y Y', ['route', 'api.v1.impact.show']),

            // 3.6 Payment web endpoints (no principal columns)
            'GET/POST pay/{token}' => ['section' => '3.6', 'cells' => [], 'checks' => [['pending', 'payment pages']]],
            'POST pay/callback' => ['section' => '3.6', 'cells' => [], 'checks' => [['pending', 'payment callback']]],
            'POST webhooks/iyzico' => ['section' => '3.6', 'cells' => [], 'checks' => [['pending', 'payment webhook']]],

            // 4 Admin panel
            'View verification queue and shop details' => self::admin('Y - Y', ['gate', 'review-shops'], ['panel', ShopResource::class, 'viewAny']),
            'Approve or reject a shop' => self::admin('Y - Y', ['gate', 'manage-shops'], ['panel', ShopResource::class, 'action', 'approve'], ['panel', ShopResource::class, 'action', 'reject']),
            'Open a shop document' => self::admin('Y - Y', ['gate', 'view-documents'], ['policy', ShopDocumentPolicy::class, 'view', ['document']], ['panel', DocumentsRelationManager::class, 'relation']),
            'Suspend a shop or hold new reservations' => self::admin('Y Y Y', ['gate', 'suspend-shops'], ['panel', AbuseFlagResource::class, 'viewAny'], ['panel', AbuseFlagResource::class, 'action', 'review']),
            'Ban or unban an `anon_id`' => self::admin('Y - Y', ['gate', 'ban-anon-devices'], ['panel', AnonDeviceResource::class, 'viewAny'], ['panel', AnonDeviceResource::class, 'action', 'ban'], ['panel', AnonDeviceResource::class, 'action', 'unban']),
            'View donations and payment events' => self::admin('- Y Y', ['gate', 'view-donations'], ['panel', DonationResource::class, 'viewAny']),
            'View payouts and reconciliation results' => self::admin('- Y Y', ['gate', 'view-payouts'], ['panel', PayoutResource::class, 'viewAny'], ['panel', PaymentMismatchResource::class, 'viewAny']),
            'Place or release an automatic payout hold' => self::admin('- Y Y', ['gate', 'manage-payouts'], ['panel', PayoutResource::class, 'action', 'hold']),
            'Trigger a refund or a manual reconciliation' => self::admin('- Y Y', ['gate', 'refund-payments'], ['panel', DonationResource::class, 'action', 'refund'], ['panel', PaymentMismatchResource::class, 'action', 'resolve']),
            'Reveal a decrypted tax number or IBAN' => self::admin('- Y Y', ['gate', 'reveal-shop-financials'], ['panel', PayoutResource::class, 'action', 'reveal_financials']),
            'Manage admin users and roles' => self::admin('- - Y', ['gate', 'admin'], ['panel', UserResource::class, 'viewAny'], ['panel', UserResource::class, 'action', 'assignRole']),
            'View activity log' => self::admin('- - Y', ['gate', 'view-activity-log'], ['panel', ActivityLogResource::class, 'viewAny']),
            'Open the Horizon dashboard' => self::admin('- - Y', ['gate', 'viewHorizon'], ['gate', 'view-horizon']),
            "Edit a hook's status or code by hand" => self::admin('- - -', ['policy', HookPolicy::class, 'update', ['hook']]),
            'Impersonate another user' => self::admin('- - -', ['gate', 'impersonate']),
            'Read any recipient identity' => self::admin('- - -', ['absent', 'no recipient identity is stored (rule AN-4)']),
        ];
    }

    /**
     * @param  Check  ...$checks
     * @return Row
     */
    private static function api(string $section, string $cells, array ...$checks): array
    {
        return ['section' => $section, 'cells' => self::cells(self::API_PRINCIPALS, $cells), 'checks' => array_values($checks)];
    }

    /**
     * @param  Check  ...$checks
     * @return Row
     */
    private static function admin(string $cells, array ...$checks): array
    {
        return ['section' => '4', 'cells' => self::cells(self::ADMIN_PRINCIPALS, $cells), 'checks' => array_values($checks)];
    }

    /**
     * @param  list<string>  $principals
     * @return array<string, string>
     */
    private static function cells(array $principals, string $cells): array
    {
        $values = explode(' ', $cells);

        return array_combine($principals, $values);
    }
}
