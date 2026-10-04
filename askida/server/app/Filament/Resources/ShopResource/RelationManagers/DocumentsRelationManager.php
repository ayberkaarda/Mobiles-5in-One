<?php

namespace App\Filament\Resources\ShopResource\RelationManagers;

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Services\DocumentUrlSigner;
use App\Filament\Support\PanelActor;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Verification documents of a shop (matrix: "Open a shop document", moderator and
 * admin). The list never carries the storage key. "View" asks DocumentUrlSigner for a
 * fresh 5-minute signed URL at click time (logged there) and sends the browser to it;
 * no permanent or public URL exists and none is printed into the page.
 */
class DocumentsRelationManager extends RelationManager
{
    protected static string $relationship = 'documents';

    protected static ?string $title = 'Belgeler';

    public static function canViewForRecord(Model $ownerRecord, string $pageClass): bool
    {
        return PanelActor::allows(AdminPermission::ViewDocuments->gate());
    }

    public function isReadOnly(): bool
    {
        return true;
    }

    public function table(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn (Builder $query): Builder => $query->whereNotNull('uploaded_at'))
            ->columns([
                Tables\Columns\TextColumn::make('kind')->label('Tür')
                    ->formatStateUsing(fn (ShopDocumentKind $state): string => match ($state) {
                        ShopDocumentKind::TaxCertificate => 'Vergi levhası',
                        ShopDocumentKind::BusinessLicense => 'İşletme belgesi',
                        ShopDocumentKind::Other => 'Diğer',
                    }),
                Tables\Columns\TextColumn::make('mime')->label('Biçim'),
                Tables\Columns\TextColumn::make('size')->label('Boyut')
                    ->formatStateUsing(fn (int $state): string => number_format($state / 1024, 0, ',', '.').' KB'),
                Tables\Columns\TextColumn::make('uploaded_at')->label('Yüklendi')->dateTime('d.m.Y H:i'),
            ])
            ->actions([
                Tables\Actions\Action::make('open')
                    ->label('Görüntüle')
                    ->icon('heroicon-o-eye')
                    ->authorize(fn (): bool => PanelActor::allows(AdminPermission::ViewDocuments->gate()))
                    ->action(function (ShopDocument $record): void {
                        $url = app(DocumentUrlSigner::class)->temporaryUrl($record, PanelActor::user());

                        $this->redirect($url);
                    }),
            ])
            ->headerActions([])
            ->bulkActions([]);
    }
}
