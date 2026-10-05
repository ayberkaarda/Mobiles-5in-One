<?php

namespace App\Domain\Cost;

/** A delivery channel with its own daily cap. */
enum Channel: string
{
    case Email = 'email';
    case Push = 'push';

    public function cap(): int
    {
        return max(0, (int) config('askida.cost.daily_'.$this->value.'_cap'));
    }
}
