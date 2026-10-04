<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Contracts\RefundsDonations;
use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\DonationResource\Pages;
use App\Filament\Support\Money;
use App\Filament\Support\PanelActor;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;

/**
 * Donations, read-only (matrix: finance and admin). Columns are the shop, item, amounts
 * and status: no donor identity, no provider token, payment id or payload, and no
 * recipient data (none exists). A refund goes through the payments domain
 * (RefundsDonations); the panel never edits the status itself.
 */
class DonationResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = Donation::class;

    protected static ?string $slug = 'donations';

    protected static ?string $navigationIcon = 'heroicon-o-banknotes';

    protected static ?string $navigationGroup = 'Finans';

    protected static ?string $modelLabel = 'bağış';

    protected static ?string $pluralModelLabel = 'Bağışlar';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::ViewDonations->gate(),
            'view' => AdminPermission::ViewDonations->gate(),
        ];
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('id')->label('Kayıt')->limit(13)->searchable(),
                Tables\Columns\TextColumn::make('shop.name')->label('İşletme'),
                Tables\Columns\TextColumn::make('item.name')->label('Ürün'),
                Tables\Columns\TextColumn::make('qty')->label('Adet'),
                Tables\Columns\TextColumn::make('amount_minor')->label('Tutar')
                    ->formatStateUsing(fn (int $state): string => Money::format($state)),
                Tables\Columns\TextColumn::make('commission_minor')->label('Komisyon')
                    ->formatStateUsing(fn (int $state): string => Money::format($state)),
                Tables\Columns\TextColumn::make('status')->label('Durum')->badge()
                    ->formatStateUsing(fn (DonationStatus $state): string => self::statusLabel($state)),
                Tables\Columns\TextColumn::make('paid_at')->label('Ödendi')->dateTime('d.m.Y H:i')->placeholder('—'),
                Tables\Columns\TextColumn::make('created_at')->label('Oluşturuldu')->dateTime('d.m.Y H:i')->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                Tables\Filters\SelectFilter::make('status')->label('Durum')
                    ->options(collect(DonationStatus::cases())->mapWithKeys(
                        fn (DonationStatus $state): array => [$state->value => self::statusLabel($state)],
                    )->all()),
            ])
            ->actions([
                Tables\Actions\Action::make('refund')
                    ->label('İade et')
                    ->icon('heroicon-o-arrow-uturn-left')
                    ->color('danger')
                    ->form([
                        Textarea::make('reason')->label('İade gerekçesi')->required()->minLength(5)->maxLength(500),
                    ])
                    ->visible(fn (Donation $record): bool => $record->status === DonationStatus::Paid && app()->bound(RefundsDonations::class))
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::RefundPayments->gate()))
                    ->action(function (Donation $record, array $data): void {
                        $actor = PanelActor::user();
                        app(RefundsDonations::class)->refund($record, $actor, (string) $data['reason']);
                        AdminAudit::log('admin.refund_requested', $actor, $record, ['reason' => (string) $data['reason']]);

                        Notification::make()->success()->title('İade talebi işlendi.')->send();
                    }),
            ])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListDonations::route('/'),
        ];
    }

    public static function statusLabel(DonationStatus $state): string
    {
        return match ($state) {
            DonationStatus::Initiated => 'Başlatıldı',
            DonationStatus::Paid => 'Ödendi',
            DonationStatus::Failed => 'Başarısız',
            DonationStatus::Refunded => 'İade edildi',
        };
    }
}
