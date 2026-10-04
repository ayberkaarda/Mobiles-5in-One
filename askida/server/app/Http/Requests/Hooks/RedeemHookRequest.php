<?php

namespace App\Http\Requests\Hooks;

use App\Domain\Hooks\Codes\HookCode;
use App\Domain\Hooks\Models\Hook;
use App\Http\Requests\Auth\ApiFormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * POST shops/{shop}/redeem. The code is normalised (upper case, no spaces or dashes,
 * I/L -> 1, O -> 0) and must then match ^[0-9A-HJKMNP-TV-Z]{8}$ (security item 6).
 */
class RedeemHookRequest extends ApiFormRequest
{
    /**
     * Authorization runs before validation: owner or staff of the shop in the path.
     */
    public function authorize(): bool
    {
        Gate::authorize('redeem', [Hook::class, $this->route('shop')]);

        return true;
    }

    protected function prepareForValidation(): void
    {
        $code = $this->input('code');

        if (is_string($code) && strlen($code) <= 32) {
            $this->merge(['code' => HookCode::normalise($code)]);
        }
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'code' => ['bail', 'required', 'string', 'regex:'.HookCode::PATTERN],
        ];
    }

    public function code(): string
    {
        return $this->string('code')->value();
    }
}
