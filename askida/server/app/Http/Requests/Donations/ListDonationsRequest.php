<?php

namespace App\Http\Requests\Donations;

use App\Domain\Donations\Models\Donation;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * GET donations?limit=&cursor= : the caller's own donations, newest first.
 */
class ListDonationsRequest extends ApiFormRequest
{
    public const DEFAULT_LIMIT = 20;

    public const MAX_LIMIT = 50;

    public function authorize(): bool
    {
        Gate::authorize('viewAny', Donation::class);

        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'limit' => ['bail', 'sometimes', 'integer', 'min:1', 'max:'.self::MAX_LIMIT],
            'cursor' => ['bail', 'sometimes', 'string', 'max:512'],
        ];
    }

    public function limit(): int
    {
        return $this->has('limit') ? $this->integer('limit') : self::DEFAULT_LIMIT;
    }
}
