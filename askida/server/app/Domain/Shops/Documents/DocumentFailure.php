<?php

namespace App\Domain\Shops\Documents;

use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;

/**
 * Why a stored document was refused at confirmation. Each case maps to a problem:
 * content that is not what was declared is 415, a size problem is 413, everything else
 * is a 422 `validation.failed` with the case value as the error code on `document`.
 */
enum DocumentFailure: string
{
    case MissingObject = 'missing_object';
    case SizeMismatch = 'size_mismatch';
    case TooLarge = 'too_large';
    case MimeMismatch = 'mime_mismatch';
    case PdfActiveContent = 'pdf_active_content';
    case PdfEncrypted = 'pdf_encrypted';
    case PdfPageLimit = 'pdf_page_limit';
    case PdfMalformed = 'pdf_malformed';

    public function toProblem(): ProblemException
    {
        $errors = [['field' => 'document', 'code' => $this->value]];

        return match ($this) {
            self::MimeMismatch => ProblemException::make(ProblemCode::UnsupportedMediaType, 415, errors: $errors),
            self::TooLarge => ProblemException::make(ProblemCode::PayloadTooLarge, 413, errors: $errors),
            default => ProblemException::make(ProblemCode::ValidationFailed, 422, errors: $errors),
        };
    }
}
