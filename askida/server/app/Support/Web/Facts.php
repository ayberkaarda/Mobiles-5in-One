<?php

namespace App\Support\Web;

use App\Domain\Hooks\Codes\HookCode;
use App\Http\Requests\Donations\StoreDonationRequest;
use App\Http\Requests\Shops\ListShopsRequest;

/**
 * The one source of the facts quoted on public pages, in the FAQ, the guides, llms.txt and
 * JSON-LD. Numbers come from the configuration or the constants the API enforces, so the
 * copy can never drift from the behaviour.
 */
final class Facts
{
    public const BRAND = 'Askıda';

    public const LEGAL_NAME = 'Askıda İyilik Teknolojileri';

    public const DOMAIN = 'askida.app';

    public const APP_ID = 'app.askida.mobile';

    public const TAGLINE = 'İyilik askıda kalmasın.';

    public const STORE_TITLE = 'Askıda: Askıda Ekmek & İyilik';

    // Version of the KVKK notice that the app sends as `kvkk_text_version`.
    public const KVKK_TEXT_VERSION = 'kvkk-2026-10';

    public const SAMPLE_NOTICE = 'Örnek metin: hukuki inceleme öncesi taslaktır.';

    public const SAMPLE_LABEL = '[ÖRNEK]';

    public static function codeLength(): int
    {
        return HookCode::LENGTH;
    }

    public static function codeValidMinutes(): int
    {
        return self::int('askida.hooks.reservation_minutes', 10);
    }

    public static function anonDailyCap(): int
    {
        return self::int('askida.hooks.anon_daily_cap', 2);
    }

    public static function anonShopDailyCap(): int
    {
        return self::int('askida.hooks.anon_shop_daily_cap', 1);
    }

    public static function radiusDefaultM(): int
    {
        return ListShopsRequest::DEFAULT_RADIUS;
    }

    public static function radiusMaxM(): int
    {
        return ListShopsRequest::MAX_RADIUS;
    }

    public static function qtyMax(): int
    {
        return StoreDonationRequest::MAX_QTY;
    }

    public static function txCapMinor(): int
    {
        return self::int('payments.caps.transaction_minor', 200_000);
    }

    public static function dayCapMinor(): int
    {
        return self::int('payments.caps.donor_day_minor', 500_000);
    }

    public static function commissionBps(): int
    {
        return self::int('payments.commission_bps', 500);
    }

    /**
     * Commission as a Turkish percentage without the sign: 500 -> "5", 750 -> "7,5".
     */
    public static function commissionPercent(): string
    {
        $formatted = number_format(self::commissionBps() / 100, 2, ',', '');

        return rtrim(rtrim($formatted, '0'), ',');
    }

    /**
     * The commission as every surface prints it: "%5 (örnek oran)".
     */
    public static function commissionLabel(): string
    {
        return '%'.self::commissionPercent().' (örnek oran)';
    }

    public static function contactEmail(): string
    {
        $email = config('web.contact_email');

        return is_string($email) && $email !== '' ? $email : 'iletisim@askida.app';
    }

    /**
     * Configured store page URLs, empty ones left out.
     *
     * @return array<'android'|'ios', string>
     */
    public static function storeUrls(): array
    {
        $urls = [];

        foreach (['android', 'ios'] as $platform) {
            $url = config('web.store_urls.'.$platform);

            if (is_string($url) && $url !== '') {
                $urls[$platform] = $url;
            }
        }

        return $urls;
    }

    private static function int(string $key, int $default): int
    {
        $value = config($key, $default);

        return is_numeric($value) ? (int) $value : $default;
    }
}
