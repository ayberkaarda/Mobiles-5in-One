<?php

namespace App\Filament\Resources\ShopResource\Pages;

use App\Filament\Resources\ShopResource;
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
        ];
    }
}
