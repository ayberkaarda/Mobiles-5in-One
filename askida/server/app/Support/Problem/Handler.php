<?php

namespace App\Support\Problem;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Exception rendering for the whole application.
 *
 * API requests (api/* or a JSON Accept header) always receive RFC 9457 problem details
 * built by ProblemException; nothing from the exception itself (message, class, SQL,
 * trace) reaches the body. Web requests receive the generic error page.
 */
final class Handler
{
    public static function register(Exceptions $exceptions): void
    {
        $exceptions->shouldRenderJsonWhen(
            static fn (Request $request): bool => self::isApi($request),
        );

        $exceptions->context(static function (): array {
            $requestId = request()->attributes->get('request_id');

            return is_string($requestId) ? ['request_id' => $requestId] : [];
        });

        $exceptions->dontReport([ProblemException::class]);

        $exceptions->render(static function (Throwable $e, Request $request): ?Response {
            // A finished response (for example a rate limiter's response callback, thrown
            // by the throttle middleware) is passed through as it is, never turned into 500.
            if ($e instanceof HttpResponseException) {
                return $e->getResponse();
            }

            if (self::isApi($request)) {
                return self::toProblem($e)->render();
            }

            return self::renderWeb($e, $request);
        });
    }

    public static function isApi(Request $request): bool
    {
        return $request->is('api', 'api/*') || $request->expectsJson();
    }

    public static function toProblem(Throwable $e): ProblemException
    {
        if ($e instanceof ProblemException) {
            return $e;
        }

        if ($e instanceof ValidationException) {
            return ProblemException::make(ProblemCode::ValidationFailed, 422, errors: self::validationErrors($e));
        }

        if ($e instanceof AuthenticationException) {
            return ProblemException::make(ProblemCode::Unauthenticated, 401);
        }

        if ($e instanceof HttpExceptionInterface) {
            $status = $e->getStatusCode();

            return ProblemException::make(
                self::codeForStatus($status),
                $status,
                headers: self::passThroughHeaders($e->getHeaders()),
            );
        }

        return ProblemException::make(ProblemCode::ServerError, 500);
    }

    public static function codeForStatus(int $status): ProblemCode
    {
        return match (true) {
            $status === 401 => ProblemCode::Unauthenticated,
            $status === 403 => ProblemCode::Forbidden,
            $status === 404 => ProblemCode::NotFound,
            $status === 405 => ProblemCode::MethodNotAllowed,
            $status === 409 => ProblemCode::Conflict,
            $status === 413 => ProblemCode::PayloadTooLarge,
            $status === 415 => ProblemCode::UnsupportedMediaType,
            $status === 422 => ProblemCode::ValidationFailed,
            $status === 429 => ProblemCode::RateLimited,
            $status === 503 => ProblemCode::ServiceUnavailable,
            $status >= 400 && $status < 500 => ProblemCode::BadRequest,
            default => ProblemCode::ServerError,
        };
    }

    /**
     * Field names and rule names only; the submitted value and the translated message
     * (which may quote the value) are never exposed.
     *
     * @return list<array{field: string, code: string}>
     */
    public static function validationErrors(ValidationException $e): array
    {
        $errors = [];

        foreach ($e->validator->failed() as $field => $rules) {
            foreach (array_keys($rules) as $rule) {
                $errors[] = ['field' => (string) $field, 'code' => self::ruleCode((string) $rule)];
            }
        }

        if ($errors === []) {
            foreach (array_keys($e->errors()) as $field) {
                $errors[] = ['field' => (string) $field, 'code' => 'invalid'];
            }
        }

        return $errors;
    }

    /**
     * Turns a rule name such as "Required" or "App\Rules\ShopCode" into a stable snake_case code.
     */
    private static function ruleCode(string $rule): string
    {
        $base = class_exists($rule) ? class_basename($rule) : $rule;
        $code = strtolower((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $base));

        return preg_match('/^[a-z0-9_.]{1,64}$/', $code) === 1 ? $code : 'invalid';
    }

    /**
     * Only the headers a client needs to react to the error are kept.
     *
     * @param  array<string, mixed>  $headers
     * @return array<string, string>
     */
    private static function passThroughHeaders(array $headers): array
    {
        $kept = [];

        foreach ($headers as $name => $value) {
            if (in_array(strtolower($name), ['retry-after', 'allow', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'], true)
                && is_scalar($value)) {
                $kept[$name] = (string) $value;
            }
        }

        return $kept;
    }

    private static function renderWeb(Throwable $e, Request $request): ?Response
    {
        // Form validation keeps its redirect-back behaviour and guests keep the login redirect.
        if ($e instanceof ValidationException || $e instanceof AuthenticationException) {
            return null;
        }

        if (app()->environment('local') && (bool) config('app.debug')) {
            return null;
        }

        $status = $e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500;
        $requestId = $request->attributes->get('request_id');
        $headers = $e instanceof HttpExceptionInterface ? self::passThroughHeaders($e->getHeaders()) : [];

        return response()->view('errors.generic', [
            'status' => $status,
            'requestId' => is_string($requestId) ? $requestId : null,
        ], $status, $headers);
    }
}
