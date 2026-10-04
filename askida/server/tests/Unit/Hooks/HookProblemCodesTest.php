<?php

use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;

/*
| ProblemCode is append-only: the Phase 1 codes keep their order and values, the hook
| and anon codes follow, and every case has a title and a type URL.
*/

it('keeps the earlier codes in place and appends the hook codes', function (): void {
    $values = array_map(static fn (ProblemCode $code): string => $code->value, ProblemCode::cases());

    expect(array_slice($values, 0, 17))->toBe([
        'validation.failed', 'auth.invalid_credentials', 'auth.locked', 'auth.unauthenticated',
        'auth.email_unverified', 'auth.token_invalid', 'forbidden', 'not_found', 'conflict',
        'rate_limited', 'payload_too_large', 'unsupported_media_type', 'server_error',
        'bad_request', 'method_not_allowed', 'https_required', 'service_unavailable',
    ])->and($values)->toContain('anon.daily_cap', 'anon.shop_cap', 'hook.none_available', 'hook.code_invalid', 'hook.code_expired')
        ->and(array_unique($values))->toHaveCount(count($values));
});

it('gives every code a title and a type URL', function (ProblemCode $code): void {
    expect($code->title())->not->toBe('')
        ->and($code->type())->toBe('https://askida.app/problems/'.$code->value);
})->with(ProblemCode::cases());

it('renders a hook problem as problem details', function (): void {
    $response = ProblemException::make(ProblemCode::HookCodeInvalid, 422)->render();

    expect($response->getStatusCode())->toBe(422)
        ->and($response->headers->get('Content-Type'))->toBe('application/problem+json')
        ->and(json_decode((string) $response->getContent(), true))->toMatchArray([
            'type' => 'https://askida.app/problems/hook.code_invalid',
            'code' => 'hook.code_invalid',
            'status' => 422,
        ]);
});
