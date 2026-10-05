<?php

namespace Tests\Security\Attack;

use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Assert;

/**
 * Shared calls and assertions of the attack suite (security checklist item 23).
 *
 * Every attack asserts the status AND the problem `code`; the state checks (rows, jobs,
 * mails) sit in the test next to it. Helpers here never catch exceptions.
 */
final class AttackKit
{
    /**
     * A JSON request as a mobile client sends it, forgetting any user resolved by an
     * earlier request of the same test.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, string>  $headers
     */
    public static function json(string $method, string $uri, ?string $token = null, array $payload = [], array $headers = [], string $ip = '127.0.0.1'): TestResponse
    {
        app('auth')->forgetGuards();

        if ($token !== null) {
            $headers['Authorization'] = 'Bearer '.$token;
        }

        return test()->withServerVariables(['REMOTE_ADDR' => $ip])->json($method, $uri, $payload, $headers);
    }

    /**
     * A request with an exact raw body (signatures and size limits are about bytes).
     *
     * @param  array<string, string>  $headers
     */
    public static function raw(string $method, string $uri, string $body, array $headers = [], string $ip = '127.0.0.1', string $contentType = 'application/json'): TestResponse
    {
        app('auth')->forgetGuards();

        $server = ['CONTENT_TYPE' => $contentType, 'HTTP_ACCEPT' => 'application/json', 'REMOTE_ADDR' => $ip];

        foreach ($headers as $name => $value) {
            $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
        }

        return test()->call($method, $uri, [], [], [], $server, $body);
    }

    /**
     * Status, problem media type and machine code of a refused request.
     */
    public static function assertProblem(TestResponse $response, int $status, string $code): void
    {
        Assert::assertSame($status, $response->status(), 'Unexpected status; body: '.$response->getContent());
        Assert::assertSame('application/problem+json', $response->headers->get('Content-Type'));
        Assert::assertSame($code, $response->json('code'));
        Assert::assertSame($status, $response->json('status'));
    }

    /**
     * Problem codes of a validation failure, as (field => code) pairs.
     *
     * @return list<string>
     */
    public static function errorPairs(TestResponse $response): array
    {
        $pairs = [];

        foreach ((array) $response->json('errors') as $error) {
            $pairs[] = (string) ($error['field'] ?? '').':'.(string) ($error['code'] ?? '');
        }

        sort($pairs);

        return $pairs;
    }

    /**
     * Tally of parallel results: `ok`, or the problem code of each refusal, with the
     * HTTP status where the job went through the HTTP kernel.
     *
     * @param  list<array<string, mixed>>  $results
     * @return array<string, int>
     */
    public static function tally(array $results): array
    {
        $counts = [];

        foreach ($results as $result) {
            $status = isset($result['status']) ? (string) $result['status'].' ' : '';
            $key = $status.(($result['ok'] ?? false) ? 'ok' : (string) ($result['code'] ?? 'unknown'));
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }

        ksort($counts);

        return $counts;
    }
}
