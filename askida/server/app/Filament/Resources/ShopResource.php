<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Shops\Exceptions\IllegalVerificationTransition;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopType;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Services\ShopVerificationService;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\ShopResource\Pages;
use App\Filament\Resources\ShopResource\RelationManagers\DocumentsRelationManager;
use App\Filament\Support\PanelActor;
use App\Filament\Support\ShopFinancialMask;
use Filament\Actions\Action;
use Filament\Forms\Components\Textarea;
use Filament\Infolists\Components\Section;
use Filament\Infolists\Components\TextEntry;
use Filament\Infolists\Infolist;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;

/**
 * Verification queue and shop details (matrix: moderator and admin). Approve and reject
 * go through ShopVerificationService; a rejection needs a reason, which is recorded in
 * the activity log. Tax number and IBAN appear masked to their last four characters.
 */
class ShopResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = Shop::class;

    protected static ?string $slug = 'shops';

    protected static ?string $navigationIcon = 'heroicon-o-building-storefront';

    protected static ?string $navigationGroup = 'Moderasyon';

    protected static ?string $modelLabel = 'işletme';

    protected static ?string $pluralModelLabel = 'İşletmeler';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::ReviewShops->gate(),
            'view' => AdminPermission::ReviewShops->gate(),
        ];
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('name')->label('Ad')->searchable(),
                Tables\Columns\TextColumn::make('type')->label('Tür')
                    ->formatStateUsing(fn (string $state): string => ShopType::tryFrom($state)?->label() ?? $state),
                Tables\Columns\TextColumn::make('il')->label('İl'),
                Tables\Columns\TextColumn::make('ilce')->label('İlçe'),
                Tables\Columns\TextColumn::make('verification_state')->label('Durum')->badge()
                    ->formatStateUsing(fn (ShopVerificationState $state): string => self::stateLabel($state)),
                Tables\Columns\IconColumn::make('is_sample')->label('Örnek')->boolean(),
                Tables\Columns\TextColumn::make('created_at')->label('Başvuru')->dateTime('d.m.Y H:i')->sortable(),
            ])
            ->defaultSort('created_at')
            ->filters([
                Tables\Filters\SelectFilter::make('verification_state')
                    ->label('Durum')
                    ->options(collect(ShopVerificationState::cases())->mapWithKeys(
                        fn (ShopVerificationState $state): array => [$state->value => self::stateLabel($state)],
                    )->all())
                    ->default(ShopVerificationState::Pending->value),
            ])
            ->actions([
                Tables\Actions\ViewAction::make(),
                self::approveAction(Tables\Actions\Action::make('approve')),
                self::rejectAction(Tables\Actions\Action::make('reject')),
            ])
            ->bulkActions([]);
    }

    public static function infolist(Infolist $infolist): Infolist
    {
        return $infolist->schema([
            Section::make('İşletme')->columns(2)->schema([
                TextEntry::make('name')->label('Ad'),
                TextEntry::make('type')->label('Tür')
                    ->formatStateUsing(fn (string $state): string => ShopType::tryFrom($state)?->label() ?? $state),
                TextEntry::make('address')->label('Adres'),
                TextEntry::make('il')->label('İl'),
                TextEntry::make('ilce')->label('İlçe'),
                TextEntry::make('phone')->label('Telefon'),
                TextEntry::make('verification_state')->label('Durum')->badge()
                    ->formatStateUsing(fn (ShopVerificationState $state): string => self::stateLabel($state)),
                TextEntry::make('verified_at')->label('Onay')->dateTime('d.m.Y H:i')->placeholder('—'),
            ]),
            Section::make('Ödeme bilgileri (maskeli)')->columns(2)->schema([
                TextEntry::make('tax_number_masked')->label('Vergi numarası')
                    ->state(fn (Shop $record): string => ShopFinancialMask::taxNumber($record)),
                TextEntry::make('iban_masked')->label('IBAN')
                    ->state(fn (Shop $record): string => ShopFinancialMask::iban($record)),
            ]),
        ]);
    }

    public static function getRelations(): array
    {
        return [
            DocumentsRelationManager::class,
        ];
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListShops::route('/'),
            'view' => Pages\ViewShop::route('/{record}'),
        ];
    }

    /**
     * @template T of Tables\Actions\Action|\Filament\Actions\Action
     *
     * @param  T  $action
     * @return T
     */
    public static function approveAction(Tables\Actions\Action|Action $action): Tables\Actions\Action|Action
    {
        return $action
            ->label('Onayla')
            ->icon('heroicon-o-check-circle')
            ->color('success')
            ->requiresConfirmation()
            ->modalDescription('İşletme onaylanınca bağışçılara ve askıdan alacaklara görünür olur.')
            ->visible(fn (Shop $record): bool => $record->verification_state === ShopVerificationState::Pending)
            ->authorize(fn (): bool => PanelActor::allows(AdminPermission::VerifyShops->gate()))
            ->action(function (Shop $record): void {
                try {
                    app(ShopVerificationService::class)->verify($record, PanelActor::user());
                } catch (IllegalVerificationTransition) {
                    Notification::make()->danger()->title('Bu işletme artık onay beklemiyor.')->send();

                    return;
                }

                $record->refresh();
                Notification::make()->success()->title('İşletme onaylandı.')->send();
            });
    }

    /**
     * @template T of Tables\Actions\Action|\Filament\Actions\Action
     *
     * @param  T  $action
     * @return T
     */
    public static function rejectAction(Tables\Actions\Action|Action $action): Tables\Actions\Action|Action
    {
        return $action
            ->label('Reddet')
            ->icon('heroicon-o-x-circle')
            ->color('danger')
            ->form([
                Textarea::make('reason')->label('Ret gerekçesi')->required()->minLength(5)->maxLength(500),
            ])
            ->visible(fn (Shop $record): bool => $record->verification_state === ShopVerificationState::Pending)
            ->authorize(fn (): bool => PanelActor::allows(AdminPermission::VerifyShops->gate()))
            ->action(function (Shop $record, array $data): void {
                $actor = PanelActor::user();

                try {
                    app(ShopVerificationService::class)->reject($record, $actor);
                } catch (IllegalVerificationTransition) {
                    Notification::make()->danger()->title('Bu işletme artık onay beklemiyor.')->send();

                    return;
                }

                AdminAudit::log('admin.shop_rejected', $actor, $record, ['reason' => (string) $data['reason']]);

                $record->refresh();
                Notification::make()->success()->title('İşletme reddedildi.')->send();
            });
    }

    public static function stateLabel(ShopVerificationState $state): string
    {
        return match ($state) {
            ShopVerificationState::Pending => 'Onay bekliyor',
            ShopVerificationState::Verified => 'Onaylı',
            ShopVerificationState::Rejected => 'Reddedildi',
        };
    }
}
