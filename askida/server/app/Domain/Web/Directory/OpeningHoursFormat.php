<?php

namespace App\Domain\Web\Directory;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validation rule of `opening_hours`: an object whose keys are week days (`mon`..`sun`),
 * each null (closed) or `{open: "HH:MM", close: "HH:MM"}` with two different times. A
 * failure reports the code `opening_hours_format` only, never the submitted value.
 */
final class OpeningHoursFormat implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_array($value) || ($value !== [] && array_is_list($value))) {
            $fail('The :attribute field must be an object of week days.');

            return;
        }

        foreach ($value as $day => $hours) {
            if (! in_array($day, OpeningHours::DAYS, true)) {
                $fail('The :attribute field has an unknown day.');

                return;
            }

            if ($hours === null) {
                continue;
            }

            if (! is_array($hours) || array_diff(array_keys($hours), ['open', 'close']) !== [] || count($hours) !== 2) {
                $fail('Each day of :attribute must be null or an object with open and close.');

                return;
            }

            $open = $hours['open'];
            $close = $hours['close'];

            if (! is_string($open) || ! is_string($close)
                || preg_match(OpeningHours::TIME_PATTERN, $open) !== 1
                || preg_match(OpeningHours::TIME_PATTERN, $close) !== 1
                || $open === $close) {
                $fail('Each day of :attribute needs two different HH:MM times.');

                return;
            }
        }
    }
}
