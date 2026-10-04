<?php

namespace App\Filament\Resources\ShopResource\Pages;

use App\Domain\Shops\Models\Shop;
use App\Filament\Resources\ShopResource;
use App\Filament\Support\RevealFinancialsAction;
use Filament\Actions\Action;
use Filament\Resources\Pages\ViewRecord;

class ViewShop extends ViewRecord
{
    protected static string $resource = ShopResource::class;

    protected function getHeaderActions(): array
    {
        return [
            ShopResource::approveAction(Action::make('approve')),
            ShopResource::rejectAction(Action::make('reject')),
            RevealFinancialsAction::configure(
                Action::make('reveal_financials'),
                fn (Shop $record): Shop => $record,
            ),
        ];
    }
}
