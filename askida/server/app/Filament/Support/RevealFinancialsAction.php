<?php

namespace App\Filament\Support;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Shops\Models\Shop;
use Closure;
use Filament\Actions\MountableAction;
use Illuminate\Support\HtmlString;

/**
 * "Reveal a decrypted tax number or IBAN" (matrix: finance and admin, draft decision D-5).
 * Opening the modal writes the activity log entry first; the decrypted values exist only
 * while the modal view renders. They are never put into component state, a notification,
 * a log property or the session, so they leave the server once, in that response.
 */
final class RevealFinancialsAction
{
    public const EVENT = 'admin.financials_revealed';

    /** Re-renders of one open modal inside this many seconds count as the same open. */
    private const WINDOW_SECONDS = 30;

    /**
     * @template T of MountableAction
     *
     * @param  T  $action
     * @param  Closure(mixed): Shop  $shopOf  Resolves the shop from the action's record.
     * @return T
     */
    public static function configure(MountableAction $action, Closure $shopOf): MountableAction
    {
        return $action
            ->label('Vergi no ve IBAN\'ı göster')
            ->icon('heroicon-o-eye')
            ->color('gray')
            ->modalHeading('Vergi numarası ve IBAN')
            ->modalDescription('Bu görüntüleme kayda geçer. Pencereyi açmak onay yerine geçer.')
            ->modalSubmitAction(false)
            ->modalCancelActionLabel('Kapat')
            ->visible(fn (): bool => PanelActor::allows(AdminPermission::RevealShopFinancials->gate()))
            ->authorize(fn (): bool => PanelActor::allows(AdminPermission::RevealShopFinancials->gate()))
            // A fresh open starts a fresh audit window. The audit itself is written where the
            // values are produced (modalContent), because a client can set the mounted
            // action directly and so skip every mount hook.
            ->mountUsing(function (mixed $record, mixed $livewire) use ($shopOf): void {
                session()->forget(self::markerKey($livewire, $shopOf($record)));
            })
            ->modalContent(function (mixed $record, mixed $livewire) use ($shopOf) {
                if (! PanelActor::allows(AdminPermission::RevealShopFinancials->gate())) {
                    return new HtmlString('');
                }

                $shop = $shopOf($record);
                self::auditOncePerOpen($livewire, $shop);

                return view('filament.modals.shop-financials', [
                    'taxNumber' => (string) $shop->tax_number_enc,
                    'iban' => (string) $shop->iban_enc,
                ]);
            })
            ->action(static fn () => null);
    }

    /**
     * Writes the entry before the caller reads the decrypted values. Re-renders of the
     * same open modal (same component, same shop) inside the window write nothing more;
     * the marker holds a timestamp only, never a value.
     */
    private static function auditOncePerOpen(mixed $livewire, Shop $shop): void
    {
        $key = self::markerKey($livewire, $shop);
        $at = session()->get($key);

        if (is_int($at) && time() - $at < self::WINDOW_SECONDS) {
            return;
        }

        AdminAudit::log(self::EVENT, PanelActor::user(), $shop, ['shop_id' => $shop->getKey()]);
        session()->put($key, time());
    }

    private static function markerKey(mixed $livewire, Shop $shop): string
    {
        $component = is_object($livewire) && method_exists($livewire, 'getId') ? (string) $livewire->getId() : 'none';

        return 'admin.reveal.'.$component.'.'.$shop->getKey();
    }
}
