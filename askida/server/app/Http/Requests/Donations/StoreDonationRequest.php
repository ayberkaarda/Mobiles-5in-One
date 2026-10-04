<?php

namespace App\Http\Requests\Donations;

use App\Domain\Donations\Models\Donation;
use App\Http\Requests\Auth\ApiFormRequest;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Support\Facades\Gate;

/**
 * POST donations. The body is exactly `shop_id`, `item_id`, `qty`: every other field
 * (an amount, a price, a currency, a commission, a donor id, a status) is refused with
 * the `prohibited` code, so a client cannot even suggest money values; the server
 * computes them (security item 23).
 */
class StoreDonationRequest extends ApiFormRequest
{
    public const FIELDS = ['shop_id', 'item_id', 'qty'];

    public const MAX_QTY = 20;

    /**
     * Authorization runs before validation: only a donor token may donate.
     */
    public function authorize(): bool
    {
        Gate::authorize('create', Donation::class);

        return true;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        $rules = [
            'shop_id' => ['bail', 'required', 'string', 'uuid'],
            'item_id' => ['bail', 'required', 'string', 'uuid'],
            'qty' => ['bail', 'required', 'integer', 'min:1', 'max:'.self::MAX_QTY],
        ];

        $unknown = array_diff(array_map('strval', array_keys($this->all())), self::FIELDS);

        $errors = [];

        foreach ($unknown as $field) {
            if (preg_match('/^[A-Za-z0-9_-]{1,64}$/', $field) !== 1) {
                // A key the validator would read as a path (dots, stars) or an oversized key.
                $errors = [['field' => '_body', 'code' => 'prohibited']];

                break;
            }

            // Key presence is enough: the `prohibited` rule would let `null` or '' through.
            $errors[] = ['field' => $field, 'code' => 'prohibited'];
        }

        if ($errors !== []) {
            throw ProblemException::make(ProblemCode::ValidationFailed, 422, errors: $errors);
        }

        return $rules;
    }
}
