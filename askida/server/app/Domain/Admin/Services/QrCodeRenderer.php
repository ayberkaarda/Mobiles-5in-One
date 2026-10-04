<?php

namespace App\Domain\Admin\Services;

use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use SensitiveParameter;

/**
 * Renders a QR code as SVG on the server. The TOTP provisioning URI never leaves the
 * application for an external QR service.
 */
final class QrCodeRenderer
{
    public function svg(#[SensitiveParameter] string $payload, int $size = 240): string
    {
        $renderer = new ImageRenderer(new RendererStyle($size, 2), new SvgImageBackEnd);

        return (new Writer($renderer))->writeString($payload);
    }

    /**
     * The SVG as a data URI for an <img> tag (allowed by the panel's img-src 'data:'),
     * so the page needs no unescaped markup.
     */
    public function dataUri(#[SensitiveParameter] string $payload, int $size = 240): string
    {
        return 'data:image/svg+xml;base64,'.base64_encode($this->svg($payload, $size));
    }
}
