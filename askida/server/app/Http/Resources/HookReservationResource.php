<?php

namespace App\Http\Resources;

use App\Domain\Hooks\Services\ReservedHook;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Reserve response: the plaintext code (shown once), its deadline, the shop and the
 * item. No unit id, no anon id, no hash.
 *
 * @property ReservedHook $resource
 */
class HookReservationResource extends JsonResource
{
    public static $wrap = null;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $reservation = $this->resource;

        return [
            'code' => $reservation->code,
            'expires_at' => $reservation->expiresAt->toIso8601String(),
            'shop' => [
                'id' => $reservation->shop->id,
                'name' => $reservation->shop->name,
            ],
            'item' => [
                'name' => $reservation->item->name,
                'category' => $reservation->item->category->value,
            ],
        ];
    }
}
