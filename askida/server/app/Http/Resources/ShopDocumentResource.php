<?php

namespace App\Http\Resources;

use App\Domain\Shops\Documents\DocumentUploadKind;
use App\Domain\Shops\Models\ShopDocument;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Document metadata for its owner. Never the storage key and never a read URL: only
 * admin roles open documents, through the panel.
 *
 * @mixin ShopDocument
 */
class ShopDocumentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ShopDocument $document */
        $document = $this->resource;

        return [
            'id' => $document->id,
            'kind' => DocumentUploadKind::fromStored($document->kind)->value ?? $document->kind->value,
            'mime' => $document->mime,
            'size' => $document->size,
            'state' => $document->uploaded_at === null ? 'pending' : 'uploaded',
            'uploaded_at' => $document->uploaded_at?->toIso8601String(),
            'created_at' => $document->created_at?->toIso8601String(),
        ];
    }
}
