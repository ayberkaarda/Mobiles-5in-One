<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\AnonDeviceResource\Pages;
use App\Filament\Support\PanelActor;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Anonymous devices (matrix: moderator and admin). The table shows the anon_id, platform,
 * attestation verdict, today's reservation counter and the ban time, nothing else (rule
 * AN-3): no token, no device nonce, no shop or donor link. Ban and unban set or clear
 * banned_at and are recorded in the activity log.
 */
class AnonDeviceResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = AnonDevice::class;

    protected static ?string $slug = 'anon-devices';

    protected static ?string $navigationIcon = 'heroicon-o-device-phone-mobile';

    protected static ?string $navigationGroup = 'Moderasyon';

    protected static ?string $modelLabel = 'anonim cihaz';

    protected static ?string $pluralModelLabel = 'Anonim cihazlar';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::BanAnonDevices->gate(),
            'view' => AdminPermission::BanAnonDevices->gate(),
        ];
    }

    /**
     * @return Builder<AnonDevice>
     */
    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()->addSelect([
            'anon_devices.*',
            'today_count' => DB::table('anon_daily_counters')
                ->selectRaw('coalesce(sum(count), 0)')
                ->whereColumn('anon_daily_counters.anon_id', 'anon_devices.anon_id')
                ->whereDate('day', now()->toDateString()),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('anon_id')->label('Anon kimliği')->searchable()->copyable(),
                Tables\Columns\TextColumn::make('platform')->label('Platform')
                    ->formatStateUsing(fn (mixed $state): string => (string) ($state->value ?? $state)),
                Tables\Columns\TextColumn::make('attestation_verdict')->label('Doğrulama sonucu')->placeholder('—'),
                Tables\Columns\TextColumn::make('today_count')->label('Bugünkü ayırma')->numeric(),
                Tables\Columns\TextColumn::make('banned_at')->label('Yasaklandı')->dateTime('d.m.Y H:i')->placeholder('—')->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                Tables\Filters\TernaryFilter::make('banned')->label('Yasaklı')
                    ->queries(
                        true: fn (Builder $query): Builder => $query->whereNotNull('banned_at'),
                        false: fn (Builder $query): Builder => $query->whereNull('banned_at'),
                    ),
            ])
            ->actions([
                Tables\Actions\Action::make('ban')
                    ->label('Yasakla')
                    ->icon('heroicon-o-no-symbol')
                    ->color('danger')
                    ->requiresConfirmation()
                    ->modalDescription('Cihaz yeni oturum alamaz ve mevcut anonim belirteci politikalarca reddedilir.')
                    ->visible(fn (AnonDevice $record): bool => $record->banned_at === null)
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::BanAnonDevices->gate()))
                    ->action(fn (AnonDevice $record) => self::setBan($record, true)),
                Tables\Actions\Action::make('unban')
                    ->label('Yasağı kaldır')
                    ->icon('heroicon-o-check-circle')
                    ->color('success')
                    ->requiresConfirmation()
                    ->visible(fn (AnonDevice $record): bool => $record->banned_at !== null)
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::BanAnonDevices->gate()))
                    ->action(fn (AnonDevice $record) => self::setBan($record, false)),
            ])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListAnonDevices::route('/'),
        ];
    }

    private static function setBan(AnonDevice $record, bool $ban): void
    {
        $actor = PanelActor::user();

        $changed = DB::transaction(function () use ($record, $actor, $ban): bool {
            /** @var AnonDevice $locked */
            $locked = AnonDevice::query()->whereKey($record->getKey())->lockForUpdate()->firstOrFail();

            if (($locked->banned_at !== null) === $ban) {
                return false;
            }

            $locked->forceFill(['banned_at' => $ban ? now() : null])->save();
            AdminAudit::log($ban ? 'admin.anon_device_banned' : 'admin.anon_device_unbanned', $actor, $locked);

            return true;
        });

        $changed
            ? Notification::make()->success()->title($ban ? 'Cihaz yasaklandı.' : 'Yasak kaldırıldı.')->send()
            : Notification::make()->warning()->title('Cihazın durumu zaten bu şekilde.')->send();
    }
}
