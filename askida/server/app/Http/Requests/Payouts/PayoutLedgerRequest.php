<?php

namespace App\Http\Requests\Payouts;

use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * GET shops/{id}/payouts?limit=&cursor= (owner of the shop only).
 */
class PayoutLedgerRequest extends ApiFormRequest
{
    public const DEFAULT_LIMIT = 30;

    public const MAX_LIMIT = 90;

    private ?Shop $shop = null;

    /**
     * Authorization runs before validation, after a plain lookup: a missing and a
     * foreign shop both answer 404, staff 403 (PayoutPolicy::viewAny).
     */
    public function authorize(): bool
    {
        $this->shop = Shop::query()->findOrFail((string) $this->route('id'));

        Gate::authorize('viewAny', [Payout::class, $this->shop]);

        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'limit' => ['bail', 'sometimes', 'integer', 'min:1', 'max:'.self::MAX_LIMIT],
            'cursor' => ['bail', 'sometimes', 'string', 'max:256'],
        ];
    }

    public function shop(): Shop
    {
        return $this->shop ?? Shop::query()->findOrFail((string) $this->route('id'));
    }

    public function limit(): int
    {
        return $this->filled('limit') ? $this->integer('limit') : self::DEFAULT_LIMIT;
    }

    public function cursor(): ?string
    {
        $cursor = $this->query('cursor');

        return is_string($cursor) && $cursor !== '' ? $cursor : null;
    }
}
