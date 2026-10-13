import { PERIODICITIES, hasPeriodicity } from './calendar.js';
import { ValidationError } from './errors.js';

// A rate is stored exactly as the lender states it (AD4):
//   { value, basis, periodicity, timing }
//   value        percent units, 2.1 means 2.1 %
//   basis        'effective': `value` is the rate over one `periodicity` period
//                             (effective + annual = EA, effective + monthly = MV)
//                'nominal':   `value` is an annual rate compounded `periodicity` times a year
//                             (nominal + monthly = NAMV, i = value / 12)
//   periodicity  one of PERIODICITIES
//   timing       'arrears' (vencido) or 'advance' (anticipado: i = ia / (1 - ia))
// Interest-free is the rate 0% EA (convention ZERO).

const BASES = Object.freeze(['effective', 'nominal']);
const TIMINGS = Object.freeze(['arrears', 'advance']);

/** Named conventions; each maps onto the structured fields above. */
export const CONVENTIONS = Object.freeze({
  EA: Object.freeze({ basis: 'effective', periodicity: 'annual', timing: 'arrears' }),
  NAMV: Object.freeze({ basis: 'nominal', periodicity: 'monthly', timing: 'arrears' }),
  MV: Object.freeze({ basis: 'effective', periodicity: 'monthly', timing: 'arrears' }),
  NATV: Object.freeze({ basis: 'nominal', periodicity: 'quarterly', timing: 'arrears' }),
  NATA: Object.freeze({ basis: 'nominal', periodicity: 'quarterly', timing: 'advance' }),
  NAMA: Object.freeze({ basis: 'nominal', periodicity: 'monthly', timing: 'advance' }),
  ZERO: Object.freeze({ basis: 'effective', periodicity: 'annual', timing: 'arrears' }),
});

const has = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);

const invalid = (message) => new ValidationError('invalid_rate', message);

/**
 * Validates a rate and returns it in its structured form.
 * Accepts `{ convention, value }` (value ignored for ZERO) or the full
 * `{ value, basis, periodicity, timing? }` shape (timing defaults to arrears).
 * @param {object} input
 * @returns {{ value: number, basis: string, periodicity: string, timing: string }}
 */
export function normalizeRate(input) {
  if (input === null || typeof input !== 'object') {
    throw invalid('a rate must be an object');
  }
  let basis;
  let periodicity;
  let timing;
  let value = input.value;
  if (input.convention !== undefined) {
    if (!has(CONVENTIONS, input.convention)) throw invalid(`unknown rate convention ${String(input.convention)}`);
    ({ basis, periodicity, timing } = CONVENTIONS[input.convention]);
    if (input.convention === 'ZERO') value = 0;
  } else {
    basis = input.basis;
    periodicity = input.periodicity;
    timing = input.timing === undefined ? 'arrears' : input.timing;
  }
  if (!BASES.includes(basis)) throw invalid(`unknown rate basis ${String(basis)}`);
  if (!hasPeriodicity(periodicity)) throw invalid(`unknown rate periodicity ${String(periodicity)}`);
  if (!TIMINGS.includes(timing)) throw invalid(`unknown rate timing ${String(timing)}`);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(`rate value must be a finite number >= 0, got ${String(value)}`);
  }
  if (timing === 'advance' && statedPeriodRate(value, basis, periodicity) >= 1) {
    throw invalid(`an anticipated rate must stay below 100% per period, got ${value}% ${basis} ${periodicity}`);
  }
  return { value, basis, periodicity, timing };
}

/** Rate over one stated period, as a fraction, before the anticipated adjustment. */
function statedPeriodRate(value, basis, periodicity) {
  return value / 100 / (basis === 'nominal' ? PERIODICITIES[periodicity].perYear : 1);
}

/** Arrears-equivalent rate over the rate's own period, as a fraction. */
function ownPeriodRate(rate) {
  const stated = statedPeriodRate(rate.value, rate.basis, rate.periodicity);
  return rate.timing === 'advance' ? stated / (1 - stated) : stated;
}

/**
 * Periodic rate `i` for the given periodicity, as a fraction (0.018 is 1.8 %).
 * @param {object} rate
 * @param {string} periodicity
 * @returns {number}
 */
export function periodicRate(rate, periodicity) {
  const stated = normalizeRate(rate);
  if (!hasPeriodicity(periodicity)) throw invalid(`unknown periodicity ${String(periodicity)}`);
  const own = ownPeriodRate(stated);
  if (stated.periodicity === periodicity) return own;
  const annual = (1 + own) ** PERIODICITIES[stated.periodicity].perYear - 1;
  return (1 + annual) ** (1 / PERIODICITIES[periodicity].perYear) - 1;
}

/**
 * Effective annual equivalent in percent units (28.32 is 28.32 % EA).
 * @param {object} rate
 * @returns {number}
 */
export function toEffectiveAnnual(rate) {
  const stated = normalizeRate(rate);
  const perYear = PERIODICITIES[stated.periodicity].perYear;
  if (perYear === 1 && stated.timing === 'arrears') return stated.value;
  return ((1 + ownPeriodRate(stated)) ** perYear - 1) * 100;
}

/**
 * Re-expresses a rate in another convention, keeping the same economic cost.
 * @param {object} rate
 * @param {string | { basis: string, periodicity: string, timing?: string }} target
 *   A convention name (except ZERO) or the structured target.
 * @returns {{ value: number, basis: string, periodicity: string, timing: string }}
 */
export function convertRate(rate, target) {
  let spec = target;
  if (typeof target === 'string') {
    if (target === 'ZERO' || !has(CONVENTIONS, target)) throw invalid(`cannot convert to convention ${target}`);
    spec = CONVENTIONS[target];
  }
  if (spec === null || typeof spec !== 'object') throw invalid('conversion target must be a convention or an object');
  const { basis, periodicity } = spec;
  const timing = spec.timing === undefined ? 'arrears' : spec.timing;
  if (!BASES.includes(basis) || !TIMINGS.includes(timing)) throw invalid('invalid conversion target');
  const i = periodicRate(rate, periodicity);
  const stated = timing === 'advance' ? i / (1 + i) : i;
  const perYear = PERIODICITIES[periodicity].perYear;
  const value = (basis === 'nominal' ? stated * perYear : stated) * 100;
  return normalizeRate({ value, basis, periodicity, timing });
}

const trimmed = (number) => String(Number(number.toFixed(4)));

function conventionOf(rate) {
  const names = Object.keys(CONVENTIONS);
  for (const name of names) {
    const spec = CONVENTIONS[name];
    if (name !== 'ZERO' && spec.basis === rate.basis && spec.periodicity === rate.periodicity && spec.timing === rate.timing) {
      return name;
    }
  }
  return null;
}

/**
 * Human-readable echo of the stated rate with its EA equivalent,
 * for example `2.1% MV ≈ 28.32% EA`.
 * @param {object} rate
 * @returns {string}
 */
export function rateLabel(rate) {
  const stated = normalizeRate(rate);
  const convention = conventionOf(stated);
  const value = trimmed(stated.value);
  if (convention === 'EA') return `${value}% EA`;
  const name =
    convention ??
    `${stated.basis === 'nominal' ? 'nominal ' : ''}${stated.periodicity}${stated.timing === 'advance' ? ' advance' : ''}`;
  return `${value}% ${name} ≈ ${toEffectiveAnnual(stated).toFixed(2)}% EA`;
}
