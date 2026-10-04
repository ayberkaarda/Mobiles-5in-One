<?php

namespace App\Domain\Items\Models;

enum ItemCategory: string
{
    case Ekmek = 'ekmek';
    case Corba = 'corba';
    case Yemek = 'yemek';
    case Kirtasiye = 'kirtasiye';
    case Bebek = 'bebek';
    case Diger = 'diger';

    /**
     * Turkish display label.
     */
    public function label(): string
    {
        return match ($this) {
            self::Ekmek => 'Ekmek',
            self::Corba => 'Çorba',
            self::Yemek => 'Yemek',
            self::Kirtasiye => 'Kırtasiye',
            self::Bebek => 'Bebek',
            self::Diger => 'Diğer',
        };
    }
}
