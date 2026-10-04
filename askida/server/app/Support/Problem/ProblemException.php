<?php

namespace App\Support\Problem;

use Illuminate\Http\JsonResponse;
use RuntimeException;

class ProblemException extends RuntimeException
{
    /**
     * @param  list<array{field: string, code: string}>  $errors
     * @param  array<string, string>  $headers
     */
    final public function __construct(
        public readonly ProblemCode $problem,
        public readonly int $status,
        ?string $detail = null,
        public readonly array $errors = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($detail ?? $problem->title());
    }

    /**
     * @param  list<array{field: string, code: string}>  $errors
     * @param  array<string, string>  $headers
     */
    public static function make(
        ProblemCode $code,
        int $status,
        ?string $detail = null,
        array $errors = [],
        array $headers = [],
    ): static {
        return new static($code, $status, $detail, $errors, $headers);
    }

    public function render(): JsonResponse
    {
        $request = request();
        $requestId = $request->attributes->get('request_id') ?? $request->header('X-Request-Id');

        $body = [
            'type' => $this->problem->type(),
            'title' => $this->problem->title(),
            'status' => $this->status,
            'code' => $this->problem->value,
            'request_id' => is_string($requestId) && $requestId !== '' ? $requestId : null,
        ];

        if ($this->errors !== []) {
            $body['errors'] = array_map(
                static fn (array $error): array => [
                    'field' => (string) $error['field'],
                    'code' => (string) $error['code'],
                ],
                $this->errors,
            );
        }

        return new JsonResponse(
            $body,
            $this->status,
            array_merge($this->headers, ['Content-Type' => 'application/problem+json']),
        );
    }
}
