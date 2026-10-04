<?php

/*
| App linking files. Verification by Apple and Google is not exercised: there is no Apple
| team, no store listing and no signing certificate for this portfolio build; the files
| are checked for shape and configuration only.
*/

it('serves the Apple app site association without an extension as JSON', function (): void {
    config(['services.apple.team_id' => 'ABCDE12345']);

    $response = $this->get('/.well-known/apple-app-site-association')
        ->assertOk()
        ->assertHeader('Content-Type', 'application/json');

    expect($response->json())->toBe([
        'applinks' => [
            'apps' => [],
            'details' => [[
                'appID' => 'ABCDE12345.app.askida.mobile',
                'appIDs' => ['ABCDE12345.app.askida.mobile'],
                'paths' => ['/dukkan/*', '/d/*'],
                'components' => [['/' => '/dukkan/*'], ['/' => '/d/*']],
            ]],
        ],
    ]);
});

it('still renders the association with the bare app id while no Apple team is configured', function (): void {
    // not exercised: no Apple team; Apple's own verification of the file needs one.
    config(['services.apple.team_id' => '']);

    $response = $this->get('/.well-known/apple-app-site-association')->assertOk();

    expect($response->json('applinks.details.0.appID'))->toBe('app.askida.mobile')
        ->and($response->json('applinks.details.0.appIDs'))->toBe(['app.askida.mobile']);
});

it('serves the Android asset links with the configured certificate fingerprints', function (): void {
    $first = implode(':', str_split(strtoupper(bin2hex(random_bytes(32))), 2));
    $second = implode(':', str_split(strtoupper(bin2hex(random_bytes(32))), 2));
    config(['web.android_cert_sha256' => [$first, $second]]);

    $response = $this->get('/.well-known/assetlinks.json')
        ->assertOk()
        ->assertHeader('Content-Type', 'application/json');

    expect($response->json())->toBe([[
        'relation' => ['delegate_permission/common.handle_all_urls'],
        'target' => [
            'namespace' => 'android_app',
            'package_name' => 'app.askida.mobile',
            'sha256_cert_fingerprints' => [$first, $second],
        ],
    ]]);
});

it('serves the asset links with an empty fingerprint list when none is configured', function (): void {
    // not exercised: no release signing certificate; Google's verification needs one.
    config(['web.android_cert_sha256' => []]);

    expect($this->get('/.well-known/assetlinks.json')->assertOk()->json('0.target.sha256_cert_fingerprints'))->toBe([]);
});

it('reads the fingerprints from a comma list in the environment', function (): void {
    $first = implode(':', str_split(strtoupper(bin2hex(random_bytes(32))), 2));
    $second = implode(':', str_split(strtoupper(bin2hex(random_bytes(32))), 2));
    putenv('WEB_ANDROID_CERT_SHA256='.$first.' , '.$second.',');
    $_ENV['WEB_ANDROID_CERT_SHA256'] = $_SERVER['WEB_ANDROID_CERT_SHA256'] = $first.' , '.$second.',';

    try {
        $config = require config_path('web.php');
    } finally {
        putenv('WEB_ANDROID_CERT_SHA256');
        unset($_ENV['WEB_ANDROID_CERT_SHA256'], $_SERVER['WEB_ANDROID_CERT_SHA256']);
    }

    expect($config['android_cert_sha256'])->toBe([$first, $second]);
});

it('reads the Apple team id from APPLE_TEAM_ID', function (): void {
    $team = strtoupper(bin2hex(random_bytes(5)));
    putenv('APPLE_TEAM_ID='.$team);
    $_ENV['APPLE_TEAM_ID'] = $_SERVER['APPLE_TEAM_ID'] = $team;

    try {
        $config = require config_path('services.php');
    } finally {
        putenv('APPLE_TEAM_ID');
        unset($_ENV['APPLE_TEAM_ID'], $_SERVER['APPLE_TEAM_ID']);
    }

    expect($config['apple']['team_id'])->toBe($team);
});
