<?php

namespace App\Domain\Auth\Enums;

enum IdentityProvider: string
{
    case Apple = 'apple';
    case Google = 'google';

    /**
     * The users column that stores the provider subject.
     */
    public function subjectColumn(): string
    {
        return $this->value.'_sub';
    }
}
