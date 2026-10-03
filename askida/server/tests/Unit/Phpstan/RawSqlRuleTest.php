<?php

use Symfony\Component\Process\Process;

/*
| Security checklist item 15: the PHPStan rule rejects interpolated or concatenated raw
| SQL and accepts bound parameters. The fixtures are outside the normal analysis paths;
| both are analysed in one PHPStan run with the project configuration.
*/

const RAW_SQL_RULE_IDENTIFIER = 'askida.rawSqlInterpolation';

/**
 * @return array{exit: int, errors: array<string, list<array{message: string, identifier: string|null}>>}
 */
function analyseRawSqlFixtures(): array
{
    static $result = null;

    if ($result !== null) {
        return $result;
    }

    $process = new Process([
        PHP_BINARY, 'vendor/bin/phpstan', 'analyse',
        '--no-progress', '--error-format=json', '--memory-limit=1G',
        '--configuration=phpstan.neon',
        'phpstan/fixtures/BadRawSql.php',
        'phpstan/fixtures/GoodRawSql.php',
    ], base_path(), null, null, 600);

    $process->run();

    $report = json_decode($process->getOutput(), true);

    expect($report)->toBeArray("PHPStan output was not JSON:\n".$process->getOutput().$process->getErrorOutput())
        ->and($report['errors'] ?? [])->toBe([]);

    $errors = ['BadRawSql.php' => [], 'GoodRawSql.php' => []];

    foreach ($report['files'] ?? [] as $path => $file) {
        foreach ($file['messages'] as $message) {
            $errors[basename((string) $path)][] = [
                'message' => (string) $message['message'],
                'identifier' => $message['identifier'] ?? null,
            ];
        }
    }

    return $result = ['exit' => (int) $process->getExitCode(), 'errors' => $errors];
}

it('reports every interpolated or concatenated raw SQL call', function (): void {
    $result = analyseRawSqlFixtures();

    // The framework's literal-string parameter types add their own argument.type errors
    // on the same lines; only this rule's errors are counted here.
    $bad = array_values(array_filter(
        $result['errors']['BadRawSql.php'],
        static fn (array $error): bool => $error['identifier'] === RAW_SQL_RULE_IDENTIFIER,
    ));

    $methods = array_map(
        static fn (array $error): string => (string) preg_replace('/^Raw SQL passed to (\w+)\(\).*$/', '$1', $error['message']),
        $bad,
    );

    expect($result['exit'])->not->toBe(0)
        ->and($methods)->toBe([
            'raw', 'whereRaw', 'orWhereRaw', 'selectRaw', 'orderByRaw', 'groupByRaw',
            'havingRaw', 'statement', 'unprepared', 'fromRaw', 'whereRaw',
        ])
        ->and($bad[0]['message'])
        ->toBe('Raw SQL passed to raw() is built with interpolation or concatenation; use bound parameters instead.');
});

it('accepts bound parameters and literal-only SQL', function (): void {
    expect(analyseRawSqlFixtures()['errors']['GoodRawSql.php'])->toBe([]);
});

it('registers the rule in the project configuration', function (): void {
    $neon = (string) file_get_contents(base_path('phpstan.neon'));
    $rules = require base_path('phpstan/rules.php');

    expect($neon)->toContain('phpstan/rules.php')
        ->and($neon)->toContain('level: 8')
        ->and($neon)->not->toContain('phpstan/fixtures')
        ->and($rules['rules'])->toContain('Askida\\PHPStan\\Rules\\NoInterpolatedRawSqlRule');
});
