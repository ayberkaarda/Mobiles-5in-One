<?php

namespace App\Domain\Auth\Models;

/**
 * Where an account deletion was requested: in the app or on the web page /hesap-silme.
 */
enum DeletionChannel: string
{
    case App = 'app';
    case Web = 'web';
}
