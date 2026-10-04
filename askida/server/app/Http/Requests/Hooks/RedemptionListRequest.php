<?php

namespace App\Http\Requests\Hooks;

use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Services\HookDay;
use App\Http\Requests\Auth\ApiFormRequest;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Gate;

/**
 * GET shops/{shop}/redemptions?day=YYYY-MM-DD (Europe/Istanbul; today when omitted).
 */
class RedemptionListRequest extends ApiFormRequest
{
    /**
     * Authorization runs before validation: owner or staff of the shop in the path.
     */
    public function authorize(): bool
    {
        Gate::authorize('viewRedemptions', [Hook::class, $this->route('shop')]);

        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'day' => ['bail', 'nullable', 'string', 'date_format:Y-m-d'],
        ];
    }

    public function day(): CarbonImmutable
    {
        return $this->filled('day')
            ? HookDay::parse($this->string('day')->value())
            : CarbonImmutable::now(HookDay::TIMEZONE)->startOfDay();
    }
}
