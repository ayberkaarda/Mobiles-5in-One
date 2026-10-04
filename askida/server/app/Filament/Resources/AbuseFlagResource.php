<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\AbuseFlagResource\Pages;
use App\Filament\Support\PanelActor;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Fraud scan findings (matrix: the abuse tool "Suspend a shop or hold new reservations",
 * moderator, finance and admin). A finding holds counters and thresholds only. Marking it
 * reviewed stores the reviewer and time; the note goes to the activity log.
 */
class AbuseFlagResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = AbuseFlag::class;

    protected static ?string $slug = 'abuse-flags';

    protected static ?string $navigationIcon = 'heroicon-o-flag';

    protected static ?string $navigationGroup = 'Moderasyon';

    protected static ?string $modelLabel = 'kötüye kullanım bulgusu';

    protected static ?string $pluralModelLabel = 'Kötüye kullanım bulguları';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::SuspendShops->gate(),
            'view' => AdminPermission::SuspendShops->gate(),
        ];
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('shop.name')->label('İşletme'),
                Tables\Columns\TextColumn::make('kind')->label('Tür'),
                Tables\Columns\TextColumn::make('detail')->label('Ayrıntı')
                    ->state(fn (AbuseFlag $record): string => (string) json_encode($record->detail, JSON_UNESCAPED_UNICODE)),
                Tables\Columns\TextColumn::make('created_at')->label('Tespit')->dateTime('d.m.Y H:i')->sortable(),
                Tables\Columns\TextColumn::make('reviewed_at')->label('İncelendi')->dateTime('d.m.Y H:i')->placeholder('—'),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                Tables\Filters\Filter::make('open')->label('İncelenmemiş')
                    ->query(fn (Builder $query): Builder => $query->whereNull('reviewed_at'))
                    ->default(),
            ])
            ->actions([
                Tables\Actions\Action::make('review')
                    ->label('İncelendi olarak işaretle')
                    ->icon('heroicon-o-check')
                    ->form([
                        Textarea::make('note')->label('İnceleme notu')->required()->minLength(5)->maxLength(1000),
                    ])
                    ->visible(fn (AbuseFlag $record): bool => $record->reviewed_at === null)
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::SuspendShops->gate()))
                    ->action(function (AbuseFlag $record, array $data): void {
                        $actor = PanelActor::user();

                        $reviewed = DB::transaction(function () use ($record, $actor, $data): bool {
                            /** @var AbuseFlag $locked */
                            $locked = AbuseFlag::query()->whereKey($record->getKey())->lockForUpdate()->firstOrFail();

                            if ($locked->reviewed_at !== null) {
                                return false;
                            }

                            $locked->forceFill(['reviewed_at' => now(), 'reviewer_id' => $actor->getKey()])->save();

                            AdminAudit::log('admin.abuse_flag_reviewed', $actor, $locked, [
                                'shop_id' => $locked->shop_id,
                                'kind' => $locked->kind,
                                'note' => (string) $data['note'],
                            ]);

                            return true;
                        });

                        $reviewed
                            ? Notification::make()->success()->title('Bulgu incelendi olarak işaretlendi.')->send()
                            : Notification::make()->warning()->title('Bu bulgu zaten incelenmiş.')->send();
                    }),
            ])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListAbuseFlags::route('/'),
        ];
    }
}
