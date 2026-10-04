<?php

namespace App\Filament\Resources;

use App\Domain\Admin\Services\AdminAudit;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Filament\Concerns\GatedByAdminAbilities;
use App\Filament\Resources\ActivityLogResource\Pages;
use Filament\Resources\Resource;
use Filament\Tables;
use Filament\Tables\Table;
use Spatie\Activitylog\Models\Activity;

/**
 * The activity log, read-only (matrix: admin). Rows show the event, ids of subject and
 * causer and only the property keys that are known to be free of personal data.
 */
class ActivityLogResource extends Resource
{
    use GatedByAdminAbilities;

    /**
     * Property keys shown in the panel. Other keys written by any domain are not displayed.
     */
    public const VISIBLE_PROPERTIES = [
        'from', 'to', 'fields', 'reason', 'note', 'role', 'kind', 'method', 'shop_id', 'donation_id', 'payout_id',
    ];

    protected static ?string $model = Activity::class;

    protected static ?string $slug = 'activity-log';

    protected static ?string $navigationIcon = 'heroicon-o-clipboard-document-list';

    protected static ?string $navigationGroup = 'Yönetim';

    protected static ?string $modelLabel = 'kayıt';

    protected static ?string $pluralModelLabel = 'Etkinlik kaydı';

    public static function abilityGates(): array
    {
        return [
            'viewAny' => AdminPermission::ViewActivityLog->gate(),
            'view' => AdminPermission::ViewActivityLog->gate(),
        ];
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('created_at')->label('Zaman')->dateTime('d.m.Y H:i:s')->sortable(),
                Tables\Columns\TextColumn::make('log_name')->label('Kayıt'),
                Tables\Columns\TextColumn::make('event')->label('Olay')->searchable(),
                Tables\Columns\TextColumn::make('subject_type')->label('Konu türü')
                    ->formatStateUsing(fn (?string $state): string => $state === null ? '—' : class_basename($state)),
                Tables\Columns\TextColumn::make('subject_id')->label('Konu')->placeholder('—'),
                Tables\Columns\TextColumn::make('causer_id')->label('Yapan')->placeholder('—'),
                Tables\Columns\TextColumn::make('details')->label('Ayrıntı')->wrap()
                    ->state(fn (Activity $record): string => self::visibleProperties($record)),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                Tables\Filters\SelectFilter::make('log_name')->label('Kayıt')->options([
                    AdminAudit::LOG_NAME => AdminAudit::LOG_NAME,
                    'shops' => 'shops',
                ]),
            ])
            ->actions([])
            ->bulkActions([]);
    }

    public static function getPages(): array
    {
        return [
            'index' => Pages\ListActivities::route('/'),
        ];
    }

    public static function visibleProperties(Activity $record): string
    {
        $properties = $record->properties?->only(self::VISIBLE_PROPERTIES)->all() ?? [];
        $parts = [];

        foreach ($properties as $key => $value) {
            $parts[] = $key.': '.(is_scalar($value) ? (string) $value : (string) json_encode($value, JSON_UNESCAPED_UNICODE));
        }

        return $parts === [] ? '—' : implode('; ', $parts);
    }
}
