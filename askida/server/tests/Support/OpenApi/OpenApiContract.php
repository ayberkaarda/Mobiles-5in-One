<?php

namespace Tests\Support\OpenApi;

use cebe\openapi\spec\MediaType;
use cebe\openapi\spec\OpenApi;
use cebe\openapi\spec\Operation;
use cebe\openapi\spec\Reference;
use cebe\openapi\spec\Schema;
use GuzzleHttp\Psr7\Response as PsrResponse;
use GuzzleHttp\Psr7\ServerRequest;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use League\OpenAPIValidation\PSR7\Exception\ValidationFailed;
use League\OpenAPIValidation\PSR7\OperationAddress;
use League\OpenAPIValidation\PSR7\ResponseValidator;
use League\OpenAPIValidation\PSR7\ServerRequestValidator;
use League\OpenAPIValidation\PSR7\ValidatorBuilder;
use PHPUnit\Framework\Assert;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Glue between the hand-written OpenAPI document (askida/docs/api/openapi.yaml) and the
 * feature tests: it loads the document once, converts the test kernel's requests and
 * responses to PSR-7 messages and validates them with league/openapi-psr7-validator.
 */
final class OpenApiContract
{
    public const PREFIX = '/api/v1';

    private static ?ValidatorBuilder $builder = null;

    private static ?ResponseValidator $responses = null;

    private static ?ServerRequestValidator $requests = null;

    /**
     * askida/docs/api/openapi.yaml: next to the server directory in a checkout and in
     * CI, mounted read-only at /var/www/docs in the compose stack.
     */
    public static function path(): string
    {
        return dirname(base_path()).'/docs/api/openapi.yaml';
    }

    public static function builder(): ValidatorBuilder
    {
        return self::$builder ??= (new ValidatorBuilder)->fromYamlFile(self::path());
    }

    public static function responses(): ResponseValidator
    {
        return self::$responses ??= self::builder()->getResponseValidator();
    }

    public static function requests(): ServerRequestValidator
    {
        return self::$requests ??= self::builder()->getServerRequestValidator();
    }

    public static function spec(): OpenApi
    {
        return self::responses()->getSchema();
    }

    /**
     * Every documented operation as "METHOD /path" with path parameters reduced to `{}`.
     *
     * @return list<string>
     */
    public static function documentedOperations(): array
    {
        $operations = [];

        foreach (self::spec()->paths as $path => $item) {
            foreach (array_keys($item->getOperations()) as $method) {
                $operations[] = strtoupper($method).' '.self::normalisePath((string) $path);
            }
        }

        sort($operations);

        return $operations;
    }

    /**
     * Every registered `api/v1` route as "METHOD /path" (HEAD left out: the framework
     * adds it to every GET route).
     *
     * @return list<string>
     */
    public static function routedOperations(): array
    {
        $operations = [];

        foreach (Route::getRoutes()->getRoutes() as $route) {
            $uri = '/'.ltrim($route->uri(), '/');

            if (! str_starts_with($uri, self::PREFIX.'/')) {
                continue;
            }

            foreach ($route->methods() as $method) {
                if ($method !== 'HEAD') {
                    $operations[] = $method.' '.self::normalisePath(substr($uri, strlen(self::PREFIX)));
                }
            }
        }

        sort($operations);

        return array_values(array_unique($operations));
    }

    public static function normalisePath(string $path): string
    {
        return (string) preg_replace('/\{[^}]+\}/', '{}', $path);
    }

    public static function operation(string $method, string $template): Operation
    {
        $item = self::spec()->paths->getPath($template);
        Assert::assertNotNull($item, "The document has no path {$template}.");

        $operation = $item->getOperations()[strtolower($method)] ?? null;
        Assert::assertInstanceOf(Operation::class, $operation, "The document has no {$method} {$template}.");

        return $operation;
    }

    /**
     * Asserts the response status is documented for the operation and the response
     * (headers and body) validates against it.
     *
     * @param  TestResponse<Response>  $response
     */
    public static function assertResponse(string $method, string $template, TestResponse $response): void
    {
        $status = $response->getStatusCode();
        $operation = self::operation($method, $template);
        Assert::assertArrayHasKey(
            (string) $status,
            $operation->responses?->getResponses() ?? [],
            "{$method} {$template} answered {$status}, which the document does not list. Body: ".self::excerpt($response),
        );

        try {
            self::responses()->validate(new OperationAddress($template, strtolower($method)), self::toPsrResponse($response));
        } catch (ValidationFailed $e) {
            Assert::fail("{$method} {$template} ({$status}) does not match the document: ".self::describe($e).' Body: '.self::excerpt($response));
        }
    }

    /**
     * Asserts the response is a documented problem with the given status and code.
     *
     * @param  TestResponse<Response>  $response
     */
    public static function assertProblem(string $method, string $template, TestResponse $response, int $status, string $code): void
    {
        Assert::assertSame($status, $response->getStatusCode(), 'Unexpected status. Body: '.self::excerpt($response));
        Assert::assertSame('application/problem+json', $response->headers->get('Content-Type'));
        Assert::assertSame($code, $response->json('code'));
        self::assertResponse($method, $template, $response);
    }

    /**
     * Asserts that the request a test is about to send matches the document (path,
     * query, security and body).
     *
     * @param  array<string, mixed>|null  $body
     * @param  array<string, string>  $headers
     */
    public static function assertRequest(string $method, string $uri, ?array $body = null, array $headers = []): void
    {
        try {
            self::requests()->validate(self::toPsrRequest($method, $uri, $body, $headers));
        } catch (ValidationFailed $e) {
            Assert::fail("{$method} {$uri} does not match the documented request: ".self::describe($e));
        }
    }

    /**
     * @param  array<string, mixed>|null  $body
     * @param  array<string, string>  $headers
     */
    public static function toPsrRequest(string $method, string $uri, ?array $body = null, array $headers = []): ServerRequest
    {
        $headers = ['Accept' => 'application/json', ...$headers];
        $content = null;

        if ($body !== null) {
            $headers['Content-Type'] = 'application/json';
            $content = json_encode($body, JSON_THROW_ON_ERROR);
        }

        $request = new ServerRequest($method, 'http://localhost'.$uri, $headers, $content);
        $query = parse_url($uri, PHP_URL_QUERY);

        if (is_string($query)) {
            parse_str($query, $params);
            $request = $request->withQueryParams($params);
        }

        return $body === null ? $request : $request->withParsedBody($body);
    }

    /**
     * @param  TestResponse<Response>  $response
     */
    public static function toPsrResponse(TestResponse $response): PsrResponse
    {
        $headers = $response->baseResponse->headers->allPreserveCaseWithoutCookies();
        $content = $response->baseResponse->getContent();

        return new PsrResponse($response->getStatusCode(), $headers, $content === false ? '' : $content);
    }

    /**
     * The JSON example of an operation's request body.
     *
     * @return array<string, mixed>
     */
    public static function requestExample(Operation $operation): array
    {
        $media = self::requestMedia($operation);
        $example = $media->example;
        Assert::assertIsArray($example, "{$operation->operationId} has no request example.");

        /** @var array<string, mixed> $example */
        $example = json_decode(json_encode($example, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);

        return $example;
    }

    /**
     * Required properties of an operation's request body, including those declared next
     * to an `allOf`.
     *
     * @return list<string>
     */
    public static function requiredFields(Operation $operation): array
    {
        $schema = self::requestMedia($operation)->schema;
        Assert::assertInstanceOf(Schema::class, $schema);

        $required = $schema->required ?? [];

        foreach ($schema->allOf ?? [] as $part) {
            if ($part instanceof Schema) {
                $required = [...$required, ...($part->required ?? [])];
            }
        }

        return array_values(array_unique(array_map('strval', $required)));
    }

    /**
     * Operations that declare a request body, keyed by operation id.
     *
     * @return array<string, array{method: string, path: string}>
     */
    public static function operationsWithBody(): array
    {
        $found = [];

        foreach (self::spec()->paths as $path => $item) {
            foreach ($item->getOperations() as $method => $operation) {
                if ($operation->requestBody !== null && ! $operation->requestBody instanceof Reference) {
                    $found[(string) $operation->operationId] = ['method' => strtoupper($method), 'path' => (string) $path];
                }
            }
        }

        ksort($found);

        return $found;
    }

    private static function requestMedia(Operation $operation): MediaType
    {
        $body = $operation->requestBody;
        Assert::assertNotNull($body, "{$operation->operationId} has no request body.");
        Assert::assertNotInstanceOf(Reference::class, $body);

        $media = $body->content['application/json'] ?? null;
        Assert::assertInstanceOf(MediaType::class, $media, "{$operation->operationId} has no JSON request body.");

        return $media;
    }

    private static function describe(Throwable $e): string
    {
        $messages = [];

        for ($current = $e; $current !== null; $current = $current->getPrevious()) {
            $messages[] = $current->getMessage();
        }

        return implode(' <- ', $messages);
    }

    /**
     * @param  TestResponse<Response>  $response
     */
    private static function excerpt(TestResponse $response): string
    {
        return substr((string) $response->baseResponse->getContent(), 0, 600);
    }
}
