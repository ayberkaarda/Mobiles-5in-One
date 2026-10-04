<?php

namespace App\Http\Requests\Shops;

use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Support\TurkiyeBounds;
use App\Http\Requests\Auth\ApiFormRequest;

/**
 * GET shops?near=lat,lng&radius=&hasAvailable=&limit=&cursor=
 *
 * `near` is split into `near_lat` / `near_lng` before validation. The point is only used
 * for the query; it is never stored and the access log records the route pattern only.
 */
class ListShopsRequest extends ApiFormRequest
{
    public const DEFAULT_RADIUS = 3000;

    public const MAX_RADIUS = 5000;

    public const DEFAULT_LIMIT = 20;

    public const MAX_LIMIT = 50;

    protected function prepareForValidation(): void
    {
        $near = $this->query('near');

        if (is_string($near) && preg_match('/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/', $near, $matches) === 1) {
            $this->merge(['near_lat' => $matches[1], 'near_lng' => $matches[2]]);
        }
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'near' => ['bail', 'required', 'string', 'max:64'],
            'near_lat' => ['bail', 'required', 'numeric', 'between:'.TurkiyeBounds::MIN_LATITUDE.','.TurkiyeBounds::MAX_LATITUDE],
            'near_lng' => ['bail', 'required', 'numeric', 'between:'.TurkiyeBounds::MIN_LONGITUDE.','.TurkiyeBounds::MAX_LONGITUDE],
            'radius' => ['bail', 'sometimes', 'integer', 'min:1', 'max:'.self::MAX_RADIUS],
            'hasAvailable' => ['bail', 'sometimes', 'in:0,1,true,false'],
            'limit' => ['bail', 'sometimes', 'integer', 'min:1', 'max:'.self::MAX_LIMIT],
            'cursor' => ['bail', 'sometimes', 'string', 'max:256'],
        ];
    }

    public function point(): GeoPoint
    {
        return new GeoPoint((float) $this->input('near_lat'), (float) $this->input('near_lng'));
    }

    public function radius(): int
    {
        return $this->has('radius') ? $this->integer('radius') : self::DEFAULT_RADIUS;
    }

    public function onlyAvailable(): bool
    {
        return in_array($this->query('hasAvailable'), ['1', 'true'], true);
    }

    public function limit(): int
    {
        return $this->has('limit') ? $this->integer('limit') : self::DEFAULT_LIMIT;
    }

    public function cursor(): ?string
    {
        $cursor = $this->query('cursor');

        return is_string($cursor) && $cursor !== '' ? $cursor : null;
    }
}
