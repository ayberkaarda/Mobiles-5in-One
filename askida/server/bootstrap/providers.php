<?php

use App\Providers\AccountsServiceProvider;
use App\Providers\AnonServiceProvider;
use App\Providers\AppServiceProvider;
use App\Providers\AuthServiceProvider;
use App\Providers\Filament\AdminPanelProvider;
use App\Providers\HorizonServiceProvider;
use App\Providers\RateLimitServiceProvider;
use App\Providers\SecurityServiceProvider;
use App\Providers\ShopsServiceProvider;

return [
    AppServiceProvider::class,
    AdminPanelProvider::class,
    HorizonServiceProvider::class,
    RateLimitServiceProvider::class,
    AuthServiceProvider::class,
    SecurityServiceProvider::class,
    ShopsServiceProvider::class,
    AnonServiceProvider::class,
    AccountsServiceProvider::class,
];
