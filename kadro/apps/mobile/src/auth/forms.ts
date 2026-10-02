import { type FieldErrors, type FieldValues, type Resolver } from 'react-hook-form';

import { type ValidationKey } from './validation';

/**
 * react-hook-form resolver over plain check functions. `check` returns an issue key per field
 * (or `null`); a field with an issue gets that key as its error message, which the screen
 * translates. This stands in for the contract schemas until `@kadro/contracts` and `zod` are
 * dependencies of the app (the validation rules are compared with those schemas in tests).
 */
export function issueResolver<Values extends FieldValues, Key extends string = ValidationKey>(
  check: (values: Values) => Readonly<Record<string, Key | null>>,
): Resolver<Values> {
  return (values) => {
    const errors: Record<string, { type: string; message: string }> = {};
    for (const [field, issue] of Object.entries(check(values))) {
      if (issue !== null) {
        // eslint-disable-next-line security/detect-object-injection -- field names come from the form's own check function
        errors[field] = { type: 'validate', message: issue };
      }
    }
    if (Object.keys(errors).length > 0) {
      return { values: {}, errors: errors as FieldErrors<Values> };
    }
    return { values, errors: {} };
  };
}
