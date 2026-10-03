<?php

namespace App\Http\Requests\Auth;

use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;

/**
 * Base request of the auth and account endpoints: a validation failure becomes a
 * `validation.failed` problem whose errors list holds only field names and rule codes,
 * never the submitted values or messages.
 */
abstract class ApiFormRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function failedValidation(Validator $validator): never
    {
        $errors = [];

        foreach ($validator->failed() as $field => $rules) {
            foreach (array_keys($rules) as $rule) {
                $errors[] = ['field' => (string) $field, 'code' => self::ruleCode((string) $rule)];
            }
        }

        throw ProblemException::make(ProblemCode::ValidationFailed, 422, errors: $errors);
    }

    /**
     * `Required` -> `required`, `Illuminate\Validation\Rules\Enum` -> `enum`,
     * `App\Domain\Auth\Passwords\Uncompromised` -> `uncompromised`.
     */
    public static function ruleCode(string $rule): string
    {
        return Str::snake(class_exists($rule) ? class_basename($rule) : $rule);
    }

    /**
     * Lower-cases and trims the email field before validation.
     */
    protected function normaliseEmail(): void
    {
        $email = $this->input('email');

        if (is_string($email)) {
            $this->merge(['email' => Str::lower(trim($email))]);
        }
    }

    protected function trimField(string $field): void
    {
        $value = $this->input($field);

        if (is_string($value)) {
            $this->merge([$field => trim($value)]);
        }
    }

    public function emailAddress(): string
    {
        return $this->string('email')->value();
    }

    /**
     * @return list<string>
     */
    protected static function deviceNameRules(): array
    {
        return ['bail', 'required', 'string', 'min:1', 'max:100'];
    }

    /**
     * @return list<string>
     */
    protected static function platformRules(): array
    {
        return ['bail', 'required', 'string', 'in:ios,android'];
    }

    /**
     * @return list<string>
     */
    protected static function emailRules(): array
    {
        return ['bail', 'required', 'string', 'max:254', 'email:rfc'];
    }

    /**
     * @return list<string>
     */
    protected static function kvkkVersionRules(bool $required): array
    {
        return ['bail', $required ? 'required' : 'nullable', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'];
    }
}
