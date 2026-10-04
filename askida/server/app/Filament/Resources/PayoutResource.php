<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\PayoutResource\Pages;
use App\Filament\Support\Money;
use App\Filament\Support\PanelActor;
use App\Filament\Support\RevealFinancialsAction;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;

/**
 * Payouts (matrix: finance and admin): a read-only mirror of provider settlements plus
 * the hold and release actions, each with a mandatory reason, executed by the payouts
 * domain (HoldsPayouts) and recorded in the activity log.
 */
class PayoutResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = Payout::class;

    protected static ?string $slug = 'payouts';

    protected static ?string $navigationIcon = 'heroicon-o-building-library';

    protected static ?string $navigationGroup = 'Finans';

    protected static ?string $modelLabel = 'ödeme aktarımı';

    protected static ?string $pluralModelLabel = 'Ödeme aktarımları';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::ViewPayouts->gate(),
            'view' => AdminPermission::ViewPayouts->gate(),
        ];
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('shop.name')->label('İşletme'),
                Tables\Columns\TextColumn::make('period')->label('Dönem')->date('d.m.Y')->sortable(),
                Tables\Columns\TextColumn::make('amount_minor')->label('Tutar')
                    ->formatStateUsing(fn (int $state): string => Money::format($state)),
                Tables\Columns\TextColumn::make('status')->label('Durum')->badge()
                    ->formatStateUsing(fn (PayoutStatus $state): string => self::statusLabel($state)),
                Tables\Columns\IconColumn::make('hold')->label('Beklemede')->boolean(),
                Tables\Columns\TextColumn::make('hold_reason')->label('Bekletme gerekçesi')->limit(60)->placeholder('—'),
            ])
            ->defaultSort('period', 'desc')
            ->filters([
                Tables\Filters\TernaryFilter::make('hold')->label('Beklemede'),
            ])
            ->actions([
                RevealFinancialsAction::configure(
                    Tables\Actions\Action::make('reveal_financials'),
                    fn (Payout $record): Shop => $record->shop()->firstOrFail(),
                ),
                Tables\Actions\Action::make('hold')
                    ->label('Beklet')
                    ->icon('heroicon-o-pause-circle')
                    ->color('warning')
                    ->form([self::reasonField()])
                    ->visible(fn (Payout $record): bool => ! $record->hold && app()->bound(HoldsPayouts::class))
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::HoldPayouts->gate()))
                    ->action(function (Payout $record, array $data): void {
                        $actor = PanelActor::user();
                        app(HoldsPayouts::class)->hold($record, $actor, (string) $data['reason']);
                        AdminAudit::log('admin.payout_held', $actor, $record, ['reason' => (string) $data['reason']]);

                        Notification::make()->success()->title('Aktarım bekletmeye alındı.')->send();
                    }),
                Tables\Actions\Action::make('release')
                    ->label('Serbest bırak')
                    ->icon('heroicon-o-play-circle')
                    ->color('success')
                    ->form([self::reasonField()])
                    ->visible(fn (Payout $record): bool => $record->hold && app()->bound(HoldsPayouts::class))
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::HoldPayouts->gate()))
                    ->action(function (Payout $record, array $data): void {
                        $actor = PanelActor::user();
                        app(HoldsPayouts::class)->release($record, $actor, (string) $data['reason']);
                        AdminAudit::log('admin.payout_released', $actor, $record, ['reason' => (string) $data['reason']]);

                        Notification::make()->success()->title('Aktarım serbest bırakıldı.')->send();
                    }),
            ])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListPayouts::route('/'),
        ];
    }

    public static function statusLabel(PayoutStatus $state): string
    {
        return match ($state) {
            PayoutStatus::Pending => 'Bekliyor',
            PayoutStatus::Held => 'Tutuldu',
            PayoutStatus::Settled => 'Aktarıldı',
            PayoutStatus::Failed => 'Başarısız',
        };
    }

    private static function reasonField(): Textarea
    {
        return Textarea::make('reason')->label('Gerekçe')->required()->minLength(5)->maxLength(191);
    }
}
