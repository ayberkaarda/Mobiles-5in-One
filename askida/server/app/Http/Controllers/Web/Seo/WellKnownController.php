<?php

namespace App\Http\Controllers\Web\Seo;

use App\Http\Controllers\Controller;
use App\Support\Web\Facts;
use Illuminate\Http\JsonResponse;

/**
 * App linking files for `app.askida.mobile`: shop links (`/dukkan/*`, `/d/*`) open the
 * app when it is installed. The Apple team id and the Android signing certificate
 * fingerprints come from configuration; without them the files still render (the app id
 * alone, an empty fingerprint list), and the platforms' own verification is not exercised
 * until real store accounts exist.
 */
final class WellKnownController extends Controller
{
    public const PATHS = ['/dukkan/*', '/d/*'];

    private const JSON = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

    public function appleAppSiteAssociation(): JsonResponse
    {
        $appId = self::appleAppId();

        return new JsonResponse([
            'applinks' => [
                'apps' => [],
                'details' => [[
                    'appID' => $appId,
                    'appIDs' => [$appId],
                    'paths' => self::PATHS,
                    'components' => array_map(static fn (string $path): array => ['/' => $path], self::PATHS),
                ]],
            ],
        ], 200, ['Content-Type' => 'application/json'], self::JSON);
    }

    public function assetLinks(): JsonResponse
    {
        return new JsonResponse([[
            'relation' => ['delegate_permission/common.handle_all_urls'],
            'target' => [
                'namespace' => 'android_app',
                'package_name' => Facts::APP_ID,
                'sha256_cert_fingerprints' => self::fingerprints(),
            ],
        ]], 200, ['Content-Type' => 'application/json'], self::JSON);
    }

    /**
     * "<team id>.app.askida.mobile", or the bare app id while no team id is configured.
     */
    public static function appleAppId(): string
    {
        $team = config('services.apple.team_id');

        return is_string($team) && trim($team) !== '' ? trim($team).'.'.Facts::APP_ID : Facts::APP_ID;
    }

    /**
     * @return list<string>
     */
    public static function fingerprints(): array
    {
        $configured = config('web.android_cert_sha256', []);

        return array_values(array_filter(
            is_array($configured) ? $configured : [],
            static fn (mixed $value): bool => is_string($value) && $value !== '',
        ));
    }
}
