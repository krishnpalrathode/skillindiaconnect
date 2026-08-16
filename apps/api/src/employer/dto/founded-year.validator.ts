import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * The earliest year we accept. Not a guess at the oldest company in the world —
 * a floor that rejects the realistic typo (`19`, `202`, `0`) while still
 * admitting genuinely old firms. Anything below this is far likelier to be a
 * mistyped year than a real one.
 */
export const FOUNDED_YEAR_MIN = 1800;

export const FOUNDED_YEAR_MESSAGE = `foundedYear must be a whole year between ${FOUNDED_YEAR_MIN} and the current year`;

/**
 * A four-digit year that is not in the future.
 *
 * The upper bound is computed AT VALIDATION TIME, not captured as a constant.
 * `@Max(new Date().getFullYear())` is evaluated once when the module loads, so a
 * process still running on 1 January would reject a company founded "this year"
 * until someone restarted it — a bug that appears once a year and is invisible
 * in every test that does not cross midnight on New Year's Eve.
 *
 * UTC deliberately: the server's local year is not the employer's, and the
 * boundary is only interesting for a few hours a year. UTC makes it one answer
 * everywhere rather than one per deployment region.
 */
@ValidatorConstraint({ name: 'isFoundedYear', async: false })
export class IsFoundedYearConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'number' || !Number.isInteger(value)) return false;
    return value >= FOUNDED_YEAR_MIN && value <= new Date().getUTCFullYear();
  }

  defaultMessage(_args: ValidationArguments): string {
    return FOUNDED_YEAR_MESSAGE;
  }
}
