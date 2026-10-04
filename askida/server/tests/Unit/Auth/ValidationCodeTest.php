<?php

use App\Domain\Auth\Passwords\Uncompromised;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rules\Enum;

it('maps validator rule names to stable snake case codes', function (string $rule, string $code): void {
    expect(ApiFormRequest::ruleCode($rule))->toBe($code);
})->with([
    ['Required', 'required'],
    ['Email', 'email'],
    ['Max', 'max'],
    ['RequiredWith', 'required_with'],
    [Enum::class, 'enum'],
    [Uncompromised::class, 'uncompromised'],
]);
