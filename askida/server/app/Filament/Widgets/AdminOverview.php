<?php

namespace App\Filament\Widgets;

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Support\PanelActor;
use Filament\Widgets\StatsOverviewWidget;
use Filament\Widgets\StatsOverviewWidget\Stat;

/**
 * Dashboard counts only: shops waiting for verification, open payment mismatches, held
 * payouts and unreviewed abuse flags. Each count is shown to the roles that may open the
 * matching list.
 */
class AdminOverview extends StatsOverviewWidget
{
    protected static ?int $sort = -1;

    /**
     * @return array<Stat>
     */
    protected function getStats(): array
    {
        $stats = [];

        if (PanelActor::allows(AdminPermission::ReviewShops->gate())) {
            $stats[] = Stat::make('Onay bekleyen işletme', (string) Shop::query()
                ->where('verification_state', ShopVerificationState::Pending->value)->count());
        }

        if (PanelActor::allows(AdminPermission::ViewPayouts->gate())) {
            $stats[] = Stat::make('Açık mutabakat farkı', (string) PaymentMismatch::query()->whereNull('resolved_at')->count());
            $stats[] = Stat::make('Bekletilen aktarım', (string) Payout::query()->where('hold', true)->count());
        }

        if (PanelActor::allows(AdminPermission::SuspendShops->gate())) {
            $stats[] = Stat::make('İncelenmemiş bulgu', (string) AbuseFlag::query()->whereNull('reviewed_at')->count());
        }

        return $stats;
    }
}
