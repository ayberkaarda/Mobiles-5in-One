<?php

namespace App\Filament\Support;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Shops\Models\Shop;
use Closure;
use Filament\Actions\MountableAction;

/**
 * "Reveal a decrypted tax number or IBAN" (matrix: finance and admin, draft decision D-5).
 * Opening the modal writes the activity log entry first; the decrypted values exist only
 * while the modal view renders. They are never put into component state, a notification,
 * a log property or the session, so they leave the server once, in that response.
 */
final class RevealFinancialsAction
{
    public const EVENT = 'admin.financials_revealed';

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
            ->mountUsing(function (mixed $record) use ($shopOf): void {
                $shop = $shopOf($record);
                AdminAudit::log(self::EVENT, PanelActor::user(), $shop, ['shop_id' => $shop->getKey()]);
            })
            ->modalContent(function (mixed $record) use ($shopOf) {
                $shop = $shopOf($record);

                return view('filament.modals.shop-financials', [
                    'taxNumber' => (string) $shop->tax_number_enc,
                    'iban' => (string) $shop->iban_enc,
                ]);
            })
            ->action(static fn () => null);
    }
}
