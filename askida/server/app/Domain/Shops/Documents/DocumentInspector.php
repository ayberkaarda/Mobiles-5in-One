<?php

namespace App\Domain\Shops\Documents;

use finfo;

/**
 * Server-side checks of an uploaded document's bytes (security checklist item 7):
 * the content sniffed by finfo and the leading magic bytes must both match the declared
 * MIME type, and a PDF must carry no active content, no encryption and at most
 * DocumentRules::MAX_PDF_PAGES pages.
 *
 * The PDF scan normalises `#xx` name escapes and also inspects every Flate-compressed
 * stream it can inflate, so names hidden in object streams are found as well.
 */
final class DocumentInspector
{
    /**
     * Names that start scripts or launch programs. `/JS` and `/JavaScript` also catch an
     * `/OpenAction` that runs a script.
     */
    private const FORBIDDEN_PDF_NAMES = ['JavaScript', 'JS', 'Launch'];

    private const MAGIC = [
        'application/pdf' => '%PDF-',
        'image/jpeg' => "\xFF\xD8\xFF",
        'image/png' => "\x89PNG\r\n\x1A\n",
    ];

    /**
     * Inflated stream data is capped so a compression bomb cannot exhaust memory.
     */
    private const MAX_INFLATED_BYTES = 20 * 1024 * 1024;

    /**
     * Returns null when the bytes are acceptable for the declared MIME type, otherwise
     * the failure code.
     */
    public function inspect(string $bytes, string $declaredMime): ?DocumentFailure
    {
        if (! isset(self::MAGIC[$declaredMime])) {
            return DocumentFailure::MimeMismatch;
        }

        $sniffed = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);

        if ($sniffed !== $declaredMime || ! str_starts_with($bytes, self::MAGIC[$declaredMime])) {
            return DocumentFailure::MimeMismatch;
        }

        return $declaredMime === 'application/pdf' ? $this->inspectPdf($bytes) : null;
    }

    private function inspectPdf(string $bytes): ?DocumentFailure
    {
        $sources = [$bytes, ...$this->inflatedStreams($bytes)];
        $pages = 0;

        foreach ($sources as $source) {
            $normalised = self::decodeNameEscapes($source);

            if (preg_match('#/Encrypt\b#', $normalised) === 1) {
                return DocumentFailure::PdfEncrypted;
            }

            foreach (self::FORBIDDEN_PDF_NAMES as $name) {
                if (preg_match('#/'.$name.'(?![A-Za-z0-9])#', $normalised) === 1) {
                    return DocumentFailure::PdfActiveContent;
                }
            }

            $pages += preg_match_all('#/Type\s*/Page(?![A-Za-z0-9])#', $normalised);
        }

        if ($pages < 1) {
            return DocumentFailure::PdfMalformed;
        }

        return $pages > DocumentRules::MAX_PDF_PAGES ? DocumentFailure::PdfPageLimit : null;
    }

    /**
     * @return list<string>
     */
    private function inflatedStreams(string $bytes): array
    {
        $streams = [];
        $total = 0;

        if (preg_match_all('#stream\r?\n(.*?)\r?\n?endstream#s', $bytes, $matches) === false) {
            return [];
        }

        foreach ($matches[1] as $raw) {
            $inflated = @zlib_decode($raw, self::MAX_INFLATED_BYTES - $total);

            if (! is_string($inflated) || $inflated === '') {
                continue;
            }

            $total += strlen($inflated);
            $streams[] = $inflated;

            if ($total >= self::MAX_INFLATED_BYTES) {
                break;
            }
        }

        return $streams;
    }

    /**
     * PDF names may spell characters as `#xx` (for example `/J#61vaScript`).
     */
    private static function decodeNameEscapes(string $value): string
    {
        return (string) preg_replace_callback(
            '#/[^\s/<>\[\]()%{}]+#',
            static fn (array $match): string => (string) preg_replace_callback(
                '/#([0-9A-Fa-f]{2})/',
                static fn (array $hex): string => chr((int) hexdec($hex[1])),
                $match[0],
            ),
            $value,
        );
    }
}
