import { PERIODICITIES, isIsoDate, periodDates } from '../calendar.js';
import { evaluateCharges } from '../charges.js';
import { ValidationError } from '../errors.js';
import { periodicRate } from '../rates.js';
import { MAX_PERIODS, validateTerms } from '../terms.js';
import { buildBullet } from './bullet.js';
import { buildFrench } from './french.js';
import { buildGerman } from './german.js';
import { buildInterestOnly } from './interestOnly.js';
import { buildManual } from './manual.js';
import { withCharges } from './row.js';

const BUILDERS = {
  french: buildFrench,
  german: buildGerman,
  bullet: buildBullet,
  interest_only: buildInterestOnly,
  manual: buildManual,
};

const invalidOption = (message) => new ValidationError('invalid_option', message);

/** Due dates of periods fromPeriod..n; manual plans carry their own dates. */
function dueDates(terms, fromPeriod, startDate) {
  if (terms.system === 'manual') return terms.manualPlan.slice(fromPeriod - 1).map(([dueOn]) => dueOn);
  if (startDate !== undefined) return periodDates(startDate, terms.periodicity, terms.n - fromPeriod + 1, terms.dueDay);
  return periodDates(terms.firstDueOn, terms.periodicity, terms.n, terms.dueDay).slice(fromPeriod - 1);
}

/**
 * Layers the terms' charges over amortization rows (period numbers are the
 * terms' own); principal is left untouched.
 * @param {object[]} rows ScheduleRow[]
 * @param {object} terms Validated terms.
 * @returns {object[]} ScheduleRow[] with charges recomputed.
 */
export function addCharges(rows, terms) {
  const shared = {
    originalMinor: terms.principalMinor,
    periodsPerYear: PERIODICITIES[terms.periodicity].perYear,
    unit: terms.roundingUnit,
  };
  return rows.map((row) => {
    const { period, openingMinor, installmentMinor } = row;
    return withCharges(row, evaluateCharges(terms.charges, { ...shared, period, openingMinor, installmentMinor }));
  });
}

/**
 * Generates the amortization schedule for the terms. Amounts are integer pesos,
 * the principal column sums to the amount being amortized and the final
 * closing balance is 0.
 *
 * Options rebuild the tail of a schedule (after a rate change or an extra
 * payment) on the original calendar:
 * - `fromPeriod`: number of the first row to generate (default 1).
 * - `balanceMinor`: opening balance of that row (default `terms.principalMinor`).
 * - `startDate`: due date of that row (default: the original calendar's date);
 *   ignored for manual plans, whose dates are explicit.
 * - `installmentMinor` (French only): keep this installment and let the number
 *   of periods float until the balance is cleared (the calendar continues past
 *   `terms.n` when needed). Throws `installment_too_low` if it cannot amortize.
 * @param {object} terms DebtTerms; validated here.
 * @param {{ fromPeriod?: number, balanceMinor?: number, startDate?: string, installmentMinor?: number }} [options]
 * @returns {object[]} ScheduleRow[]; empty for a balance-only (`system: 'none'`) debt.
 */
export function buildSchedule(terms, options = {}) {
  const normalized = validateTerms(terms);
  if (normalized.system === 'none') return [];
  const { fromPeriod = 1, balanceMinor = normalized.principalMinor, startDate, installmentMinor } = options;
  if (!Number.isInteger(fromPeriod) || fromPeriod < 1 || fromPeriod > normalized.n) {
    throw invalidOption(`fromPeriod must be a whole number in 1..${normalized.n}, got ${String(fromPeriod)}`);
  }
  if (!Number.isSafeInteger(balanceMinor) || balanceMinor < 0) {
    throw invalidOption(`balanceMinor must be a whole number of pesos >= 0, got ${String(balanceMinor)}`);
  }
  if (startDate !== undefined && !isIsoDate(startDate)) {
    throw invalidOption(`startDate must be a real YYYY-MM-DD date, got ${String(startDate)}`);
  }
  if (installmentMinor !== undefined && (normalized.system !== 'french' || !Number.isSafeInteger(installmentMinor) || installmentMinor < 1)) {
    throw invalidOption(`installmentMinor must be a positive whole number of pesos and needs the french system, got ${String(installmentMinor)}`);
  }
  const calendar = installmentMinor === undefined ? normalized : { ...normalized, n: MAX_PERIODS };
  const rows = BUILDERS[normalized.system]({
    terms: normalized,
    i: periodicRate(normalized.rate, normalized.periodicity),
    unit: normalized.roundingUnit,
    balance: balanceMinor,
    fromPeriod,
    dates: dueDates(calendar, fromPeriod, startDate),
    installment: installmentMinor,
  });
  return normalized.charges.length === 0 ? rows : addCharges(rows, normalized);
}

/**
 * Totals of a schedule, with principal kept apart from the cost of the debt.
 * Installments are principal + interest, so `totalDueMinor` equals principal +
 * interest + charges + taxes exactly.
 * @param {object[]} rows ScheduleRow[]
 * @returns {{ count: number, principalMinor: number, interestMinor: number, chargesMinor: number,
 *   taxesMinor: number, installmentsMinor: number, totalDueMinor: number, costMinor: number }}
 */
export function summarizeSchedule(rows) {
  const totals = {
    count: rows.length,
    principalMinor: 0,
    interestMinor: 0,
    chargesMinor: 0,
    taxesMinor: 0,
    installmentsMinor: 0,
    totalDueMinor: 0,
    costMinor: 0,
  };
  for (const row of rows) {
    totals.principalMinor += row.principalMinor;
    totals.interestMinor += row.interestMinor;
    totals.chargesMinor += row.chargesMinor;
    totals.taxesMinor += row.taxesMinor;
    totals.installmentsMinor += row.installmentMinor;
    totals.totalDueMinor += row.totalDueMinor;
    totals.costMinor += row.costMinor;
  }
  return totals;
}
