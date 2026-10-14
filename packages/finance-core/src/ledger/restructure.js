import { compareIso } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { validateTerms } from '../terms.js';
import { replayLoanAt } from './project.js';
import { carryOf } from './tail.js';

// Helpers for a `restructure` event (DL2, DL3): what it refinances and the terms it starts from.
// The event itself is written through `planCommit` and previewed with `previewChange`.

// Parts of the old plan that make no sense on a new calendar; a restructure sets them again if it wants them.
const PLAN_SHAPE = ['grace', 'balloonMinor', 'manualPlan', 'dueDay'];

const unsupported = () => new ValidationError('restructure_unsupported', 'a card cannot be restructured');

/**
 * What a restructure effective on `on` would refinance: the debt's balance and the unpaid interest, charges,
 * taxes and mora of the installments due on or before `on` (mora accrued up to `on`). `carriedMinor` is their
 * sum, the balance a restructure without `waiveLate` carries; `waivableLateMinor` is the part `waiveLate`
 * forgives. Pure and read-only.
 * @param {object} debt A `debts` row (see `project`).
 * @param {object[]} events The debt's `debt_events` rows; events dated after `on` and voided ones are left out.
 * @param {string} on Effective date, `YYYY-MM-DD`.
 * @param {object} [opts] `legal` as in `project`.
 * @returns {{ balanceMinor: number, arrears: { interest: number, charges: number, taxes: number, lateInterest: number },
 *   carriedMinor: number, waivableLateMinor: number }}
 * @throws {ValidationError} `invalid_date`, or `restructure_unsupported` for a card
 */
export function restructureCarry(debt, events, on, opts = {}) {
  const replay = replayLoanAt(debt, events, on, opts);
  if (replay === null) throw unsupported();
  return carryOf(replay.state, on);
}

/**
 * The terms of a restructure: the terms in force with the carried balance as principal, opened on the effective
 * date, and the `overrides` on top (rate, system, periodicity, `n`, `firstDueOn`, charges, grace, balloon, `late`...;
 * an override that is `undefined` is ignored). The mora policy and the other settings of the current terms carry
 * over; the old grace, balloon, fixed due day and manual plan do not.
 * @param {object} current The terms in force (`projection.terms`).
 * @param {{ effectiveOn: string, carriedMinor: number, overrides?: object }} change
 * @returns {object} Validated DebtTerms, ready for a `restructure` draft.
 * @throws {ValidationError} `restructure_unsupported` for a card, `invalid_first_due` when a scheduled plan does not
 *   start after `effectiveOn`, otherwise what `validateTerms` throws
 */
export function buildRestructureTerms(current, { effectiveOn, carriedMinor, overrides = {} }) {
  if (current?.kind === 'card') throw unsupported();
  const base = { ...current };
  for (const key of PLAN_SHAPE) delete base[key];
  const given = {};
  for (const key of Object.keys(overrides)) if (overrides[key] !== undefined) given[key] = overrides[key];
  const terms = validateTerms({ ...base, ...given, principalMinor: carriedMinor, openedOn: effectiveOn });
  if (terms.system !== 'none' && compareIso(terms.firstDueOn, effectiveOn) <= 0) {
    throw new ValidationError('invalid_first_due', `the first due date ${terms.firstDueOn} must be after the effective date ${effectiveOn}`);
  }
  return terms;
}
