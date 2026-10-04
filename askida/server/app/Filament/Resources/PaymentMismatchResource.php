<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\PaymentMismatchResource\Pages;
use App\Filament\Support\PanelActor;
use Filament\Forms\Components\Textarea;
use Filament\Notifications\Notification;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Reconciliation findings (matrix: "View payouts and reconciliation results" to read,
 * "Trigger a refund or a manual reconciliation" to resolve; finance and admin). Resolving
 * records who, when and a note; it never changes the donation.
 */
class PaymentMismatchResource extends Resource
{
    use GatedByAdminAbilities;

    protected static ?string $model = PaymentMismatch::class;

    protected static ?string $slug = 'payment-mismatches';

    protected static ?string $navigationIcon = 'heroicon-o-exclamation-triangle';

    protected static ?string $navigationGroup = 'Finans';

    protected static ?string $modelLabel = 'mutabakat farkı';

    protected static ?string $pluralModelLabel = 'Mutabakat farkları';

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
                Tables\Columns\TextColumn::make('donation_id')->label('Bağış')->limit(13),
                Tables\Columns\TextColumn::make('kind')->label('Tür'),
                Tables\Columns\TextColumn::make('ours')->label('Bizdeki')
                    ->state(fn (PaymentMismatch $record): string => self::snapshot($record->ours)),
                Tables\Columns\TextColumn::make('theirs')->label('Sağlayıcıdaki')
                    ->state(fn (PaymentMismatch $record): string => self::snapshot($record->theirs)),
                Tables\Columns\TextColumn::make('detected_at')->label('Tespit')->dateTime('d.m.Y H:i')->sortable(),
                Tables\Columns\TextColumn::make('resolved_at')->label('Çözüldü')->dateTime('d.m.Y H:i')->placeholder('—'),
                Tables\Columns\TextColumn::make('resolution_note')->label('Not')->limit(60)->placeholder('—'),
            ])
            ->defaultSort('detected_at', 'desc')
            ->filters([
                Tables\Filters\Filter::make('open')->label('Açık olanlar')
                    ->query(fn (Builder $query): Builder => $query->whereNull('resolved_at'))
                    ->default(),
            ])
            ->actions([
                Tables\Actions\Action::make('resolve')
                    ->label('Çözüldü olarak işaretle')
                    ->icon('heroicon-o-check')
                    ->form([
                        Textarea::make('note')->label('Çözüm notu')->required()->minLength(5)->maxLength(1000),
                    ])
                    ->visible(fn (PaymentMismatch $record): bool => $record->resolved_at === null)
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::RefundPayments->gate()))
                    ->action(function (PaymentMismatch $record, array $data): void {
                        $actor = PanelActor::user();

                        $resolved = DB::transaction(function () use ($record, $actor, $data): bool {
                            /** @var PaymentMismatch $locked */
                            $locked = PaymentMismatch::query()->whereKey($record->getKey())->lockForUpdate()->firstOrFail();

                            if ($locked->resolved_at !== null) {
                                return false;
                            }

                            $locked->forceFill([
                                'resolved_at' => now(),
                                'resolved_by' => $actor->getKey(),
                                'resolution_note' => (string) $data['note'],
                            ])->save();

                            AdminAudit::log('admin.mismatch_resolved', $actor, $locked, ['donation_id' => $locked->donation_id, 'kind' => $locked->kind]);

                            return true;
                        });

                        $resolved
                            ? Notification::make()->success()->title('Fark çözüldü olarak işaretlendi.')->send()
                            : Notification::make()->warning()->title('Bu fark zaten çözülmüş.')->send();
                    }),
            ])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListPaymentMismatches::route('/'),
        ];
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private static function snapshot(array $values): string
    {
        $parts = [];

        foreach ($values as $key => $value) {
            $parts[] = $key.': '.(is_scalar($value) || $value === null ? var_export($value, true) : json_encode($value));
        }

        return implode(', ', $parts);
    }
}
