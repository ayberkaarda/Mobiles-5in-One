<?php

use App\Domain\Shops\Documents\DocumentFailure;
use App\Domain\Shops\Documents\DocumentInspector;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

it('accepts real PDF, JPEG and PNG bytes for their declared type', function (string $mime, Closure $bytes): void {
    expect((new DocumentInspector)->inspect($bytes(), $mime))->toBeNull();
})->with([
    'pdf' => ['application/pdf', fn () => ShopTestKit::pdf(3)],
    'pdf with ten pages' => ['application/pdf', fn () => ShopTestKit::pdf(10)],
    'jpeg' => ['image/jpeg', fn () => ShopTestKit::jpeg()],
    'png' => ['image/png', fn () => ShopTestKit::png()],
]);

it('rejects bytes that are not what was declared', function (string $mime, Closure $bytes): void {
    expect((new DocumentInspector)->inspect($bytes(), $mime))->toBe(DocumentFailure::MimeMismatch);
})->with([
    'windows executable as pdf' => ['application/pdf', fn () => ShopTestKit::executable()],
    'windows executable as jpeg' => ['image/jpeg', fn () => ShopTestKit::executable()],
    'elf binary as png' => ['image/png', fn () => "\x7FELF\x02\x01\x01".str_repeat("\x00", 120)],
    'shell script as pdf' => ['application/pdf', fn () => "#!/bin/sh\necho hi\n"],
    'html as pdf' => ['application/pdf', fn () => '<html><body>%PDF-1.4</body></html>'],
    'png as jpeg' => ['image/jpeg', fn () => ShopTestKit::png()],
    'jpeg as png' => ['image/png', fn () => ShopTestKit::jpeg()],
    'pdf as png' => ['image/png', fn () => ShopTestKit::pdf()],
    'undeclared type' => ['image/gif', fn () => "GIF89a\x01\x00\x01\x00"],
]);

it('rejects PDFs with active content, also when hidden by escapes or compression', function (Closure $bytes): void {
    expect((new DocumentInspector)->inspect($bytes(), 'application/pdf'))->toBe(DocumentFailure::PdfActiveContent);
})->with([
    'javascript action' => fn () => ShopTestKit::pdf(1, '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'),
    'js name only' => fn () => ShopTestKit::pdf(1, '/Names << /JS 9 0 R >>'),
    'launch action' => fn () => ShopTestKit::pdf(1, '/OpenAction << /S /Launch /F (cmd.exe) >>'),
    'hex-escaped name' => fn () => ShopTestKit::pdf(1, '/OpenAction << /S /J#61vaScript /JS (x) >>'),
    'hex-escaped launch' => fn () => ShopTestKit::pdf(1, '/AA << /O << /S /L#61unch >> >>'),
    'inside a compressed stream' => function (): string {
        $payload = (string) gzcompress('<< /S /JavaScript /JS (app.alert(1)) >>');

        return ShopTestKit::pdf(1, '', '<< /Length '.strlen($payload)." /Filter /FlateDecode >>\nstream\n".$payload."\nendstream");
    },
]);

it('rejects encrypted PDFs and PDFs over ten pages or without pages', function (Closure $bytes, DocumentFailure $failure): void {
    expect((new DocumentInspector)->inspect($bytes(), 'application/pdf'))->toBe($failure);
})->with([
    'encrypted' => [fn () => ShopTestKit::pdf(1, '/Encrypt 9 0 R'), DocumentFailure::PdfEncrypted],
    'eleven pages' => [fn () => ShopTestKit::pdf(11), DocumentFailure::PdfPageLimit],
    'no page' => [fn () => "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", DocumentFailure::PdfMalformed],
]);

it('does not mistake /Pages or /JSON-like names for forbidden ones', function (): void {
    $pdf = ShopTestKit::pdf(2, '/Metadata << /JSONish true /Launcher (x) >>');

    expect((new DocumentInspector)->inspect($pdf, 'application/pdf'))->toBeNull();
});

it('maps failures to problems', function (DocumentFailure $failure, int $status, string $code): void {
    $problem = $failure->toProblem();

    expect($problem->status)->toBe($status)
        ->and($problem->problem->value)->toBe($code)
        ->and($problem->errors)->toBe([['field' => 'document', 'code' => $failure->value]]);
})->with([
    [DocumentFailure::MimeMismatch, 415, 'unsupported_media_type'],
    [DocumentFailure::TooLarge, 413, 'payload_too_large'],
    [DocumentFailure::PdfActiveContent, 422, 'validation.failed'],
    [DocumentFailure::MissingObject, 422, 'validation.failed'],
]);
