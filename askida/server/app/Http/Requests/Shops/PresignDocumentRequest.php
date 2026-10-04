<?php

namespace App\Http\Requests\Shops;

use App\Domain\Shops\Documents\DocumentRules;
use App\Domain\Shops\Documents\DocumentUploadKind;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Validation\Rule;

/**
 * POST shops/{id}/documents/presign: declared kind, MIME type and size. The declared
 * values are checked again against the stored object when the upload is confirmed.
 */
class PresignDocumentRequest extends ApiFormRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'kind' => ['bail', 'required', 'string', Rule::enum(DocumentUploadKind::class)],
            'mime' => ['bail', 'required', 'string', Rule::in(DocumentRules::MIME_TYPES)],
            'size' => ['bail', 'required', 'integer', 'min:1', 'max:'.DocumentRules::MAX_BYTES],
        ];
    }

    public function kind(): DocumentUploadKind
    {
        return DocumentUploadKind::from($this->string('kind')->value());
    }

    public function mime(): string
    {
        return $this->string('mime')->value();
    }

    public function size(): int
    {
        return $this->integer('size');
    }
}
