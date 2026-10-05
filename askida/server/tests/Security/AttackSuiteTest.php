<?php

use Symfony\Component\Finder\Finder;

/*
| Attack suite index (security checklist item 23). Each threat of the register in
| docs/security/threat-model.md (4.1 to 4.11), plus spoofed headers, the token lifecycle
| and upload abuse, has its own file under tests/Security/Attack, named with its number.
| This file checks the suite itself, so it cannot silently shrink or turn falsely green:
| every threat file exists and holds tests, states problem codes and a negative control,
| synchronises without sleeping, never swallows an exception and skips nothing. The
| attacks themselves run from their own files (`php artisan test tests/Security`).
*/

const ATTACK_SUITE = [
    '01' => ['file' => 'Threat01RedeemCodeBruteForceTest.php', 'register' => '4.1 Redemption code brute force'],
    '02' => ['file' => 'Threat02RedeemRaceTest.php', 'register' => '4.2 Redemption race and double-spend'],
    '03' => ['file' => 'Threat03AnonFarmingTest.php', 'register' => '4.3 Anon farming across devices and emulators'],
    '04' => ['file' => 'Threat04SelfRedeemCollusionTest.php', 'register' => '4.4 Merchant self-redeem collusion'],
    '05' => ['file' => 'Threat05WebhookCallbackForgeryTest.php', 'register' => '4.5 Webhook and callback forgery'],
    '06' => ['file' => 'Threat06IdorTest.php', 'register' => '4.6 IDOR on donations and documents'],
    '07' => ['file' => 'Threat07PrivateDocumentLeakTest.php', 'register' => '4.7 Private document leak'],
    '08' => ['file' => 'Threat08WebCsrfTest.php', 'register' => '4.8 CSRF on web'],
    '09' => ['file' => 'Threat09FilamentExposureTest.php', 'register' => '4.9 Filament exposure'],
    '10' => ['file' => 'Threat10WebViewHostTest.php', 'register' => '4.10 WebView phishing'],
    '11' => ['file' => 'Threat11AmountTamperingTest.php', 'register' => '4.11 Payment amount tampering'],
    '12' => ['file' => 'Threat12SpoofedHeadersTest.php', 'register' => null],
    '13' => ['file' => 'Threat13TokenLifecycleTest.php', 'register' => null],
    '14' => ['file' => 'Threat14UploadAbuseTest.php', 'register' => null],
];

function attackSuiteSource(string $file): string
{
    $path = __DIR__.'/Attack/'.$file;
    expect(is_file($path))->toBeTrue("Missing attack file {$file}.");

    return (string) file_get_contents($path);
}

/**
 * Source with comments and string literals removed, so rules apply to code only.
 */
function attackSuiteCode(string $source): string
{
    $code = '';

    foreach (token_get_all($source) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT, T_CONSTANT_ENCAPSED_STRING, T_ENCAPSED_AND_WHITESPACE, T_INLINE_HTML], true)) {
            continue;
        }

        $code .= is_array($token) ? $token[1] : $token;
    }

    return $code;
}

foreach (ATTACK_SUITE as $number => $entry) {
    describe("threat {$number}: {$entry['file']}", function () use ($entry): void {
        it('exists, names its threat and holds at least two tests', function () use ($entry): void {
            $source = attackSuiteSource($entry['file']);

            expect(preg_match_all('/^it\(/m', $source))->toBeGreaterThanOrEqual(2);

            if ($entry['register'] !== null) {
                $register = (string) file_get_contents(dirname(base_path()).'/docs/security/threat-model.md');
                expect($register)->toContain('### '.$entry['register'])
                    ->and($source)->toContain('Threat '.strtok($entry['register'], ' '));
            }
        });

        it('states the refusal (API: status and problem code; web and object store: status) and carries a negative control', function () use ($entry): void {
            $source = attackSuiteSource($entry['file']);

            // API refusals carry a problem code; web pages and the object store answer
            // with a status only, asserted explicitly.
            $statesRefusal = str_contains($source, 'assertProblem(')
                || preg_match("/'\\d{3} [a-z_.]+'/", $source) === 1
                || preg_match('/assert(Status\(4\d\d|NotFound\(|Forbidden\()|toBe(In)?\(\[?4\d\d/', $source) === 1;

            expect($statesRefusal)->toBeTrue('No refusal assertion.')
                ->and(stripos($source, 'negative control'))->not->toBeFalse('No negative control.');
        });

        it('neither sleeps, swallows exceptions nor skips', function () use ($entry): void {
            $code = attackSuiteCode(attackSuiteSource($entry['file']));

            expect($code)->not->toMatch('/\b(sleep|usleep|time_nanosleep|time_sleep_until)\s*\(/')
                ->and($code)->not->toMatch('/catch\s*\([^)]*\)\s*\{\s*\}/')
                ->and($code)->not->toMatch('/->(skip|todo)\(|markTestSkipped|markTestIncomplete/');
        });
    });
}

it('has no attack file outside the numbered list', function (): void {
    $files = [];

    foreach ((new Finder)->files()->in(__DIR__.'/Attack')->name('*Test.php') as $file) {
        $files[] = $file->getFilename();
    }

    sort($files);

    expect($files)->toBe(array_values(array_column(ATTACK_SUITE, 'file')));
});
