<?php

namespace App\Http\Requests\Hooks;

use App\Domain\Hooks\Models\Hook;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * POST hooks/reserve. The anon id never comes from the body: it is the token's device.
 */
class ReserveHookRequest extends ApiFormRequest
{
    /**
     * Authorization runs before validation: only a (not banned) anon device may reserve.
     */
    public function authorize(): bool
    {
        Gate::authorize('reserve', Hook::class);

        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'shop_id' => ['bail', 'required', 'string', 'uuid'],
            'item_id' => ['bail', 'required', 'string', 'uuid'],
            'anon_id' => ['prohibited'],
        ];
    }
}
