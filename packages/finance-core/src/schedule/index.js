import { isIsoDate, periodDates } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { periodicRate } from '../rates.js';
import { validateTerms } from '../terms.js';
import { buildFrench } from './french.js';

const BUILDERS = { french: buildFrench };

const invalidOption = (message) => new ValidationError('invalid_option', message);

/**
 * Generates the amortization schedule for the terms. Amounts are integer pesos,
 * the principal column sums to the amount being amortized and the final
 * closing balance is 0.
 *
 * Options rebuild the tail of a schedule (after a rate change or an extra
 * payment) on the original calendar:
 * - `fromPeriod`: number of the first row to generate (default 1).
 * - `balanceMinor`: opening balance of that row (default `terms.principalMinor`).
 * - `startDate`: due date of that row (default: the original calendar's date).
 * @param {object} terms DebtTerms; validated here.
 * @param {{ fromPeriod?: number, balanceMinor?: number, startDate?: string }} [options]
 * @returns {object[]} ScheduleRow[]; empty for a balance-only (`system: 'none'`) debt.
 */
export function buildSchedule(terms, options = {}) {
  const normalized = validateTerms(terms);
  if (normalized.system === 'none') return [];
  const { fromPeriod = 1, balanceMinor = normalized.principalMinor, startDate } = options;
  if (!Number.isInteger(fromPeriod) || fromPeriod < 1 || fromPeriod > normalized.n) {
    throw invalidOption(`fromPeriod must be a whole number in 1..${normalized.n}, got ${String(fromPeriod)}`);
  }
  if (!Number.isSafeInteger(balanceMinor) || balanceMinor < 0) {
    throw invalidOption(`balanceMinor must be a whole number of pesos >= 0, got ${String(balanceMinor)}`);
  }
  if (startDate !== undefined && !isIsoDate(startDate)) {
    throw invalidOption(`startDate must be a real YYYY-MM-DD date, got ${String(startDate)}`);
  }
  const build = BUILDERS[normalized.system];
  if (!build) throw new ValidationError('unsupported_system', `no schedule builder for ${normalized.system}`);

  const count = normalized.n - fromPeriod + 1;
  const dates =
    startDate === undefined
      ? periodDates(normalized.firstDueOn, normalized.periodicity, normalized.n, normalized.dueDay).slice(fromPeriod - 1)
      : periodDates(startDate, normalized.periodicity, count, normalized.dueDay);
  return build({
    terms: normalized,
    i: periodicRate(normalized.rate, normalized.periodicity),
    unit: normalized.roundingUnit,
    balance: balanceMinor,
    fromPeriod,
    dates,
  });
}
