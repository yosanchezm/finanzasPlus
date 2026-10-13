import { ValidationError } from './errors.js';

// Dates are `YYYY-MM-DD` strings and all arithmetic goes through `Date.UTC`,
// so results never depend on the host time zone or daylight-saving rules (AD4).

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

/**
 * Supported payment periodicities. `days` is set for day-based periods,
 * `months` for month-based ones. `perYear` is the number of periods in a year
 * and is what rate conversion compounds over (weekly = 52, biweekly = 26).
 */
export const PERIODICITIES = Object.freeze({
  weekly: Object.freeze({ days: 7, perYear: 52 }),
  biweekly: Object.freeze({ days: 14, perYear: 26 }),
  monthly: Object.freeze({ months: 1, perYear: 12 }),
  bimonthly: Object.freeze({ months: 2, perYear: 6 }),
  quarterly: Object.freeze({ months: 3, perYear: 4 }),
  semiannual: Object.freeze({ months: 6, perYear: 2 }),
  annual: Object.freeze({ months: 12, perYear: 1 }),
});

/**
 * True when `value` names a supported periodicity.
 * @param {unknown} value
 * @returns {boolean}
 */
export const hasPeriodicity = (value) =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERIODICITIES, value);

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const pad = (value, width) => String(value).padStart(width, '0');

const format = (year, month, day) => `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;

function parts(iso) {
  const match = typeof iso === 'string' ? ISO_PATTERN.exec(iso) : null;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year >= MIN_YEAR && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)) {
      return { year, month, day };
    }
  }
  throw new ValidationError('invalid_date', `expected a real YYYY-MM-DD date, got ${String(iso)}`);
}

const toMs = (iso) => {
  const { year, month, day } = parts(iso);
  return Date.UTC(year, month - 1, day);
};

/**
 * True for a real calendar date written as `YYYY-MM-DD`.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  try {
    parts(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} iso
 * @param {number} days Whole days, negative to go back.
 * @returns {string}
 */
export function addDays(iso, days) {
  if (!Number.isInteger(days)) {
    throw new ValidationError('invalid_days', `days must be an integer, got ${String(days)}`);
  }
  const moved = new Date(toMs(iso) + days * MS_PER_DAY);
  return format(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/**
 * Adds whole months and clamps the day to the end of the target month.
 * @param {string} iso
 * @param {number} months Whole months, negative to go back.
 * @param {number} [anchorDay] Day the schedule aims for; defaults to the day of `iso`.
 *   Passing 31 lets 2026-02-28 move on to 2026-03-31.
 * @returns {string}
 */
export function addMonthsClamped(iso, months, anchorDay) {
  const { year, month, day } = parts(iso);
  const anchor = anchorDay === undefined ? day : anchorDay;
  if (!Number.isInteger(months)) {
    throw new ValidationError('invalid_months', `months must be an integer, got ${String(months)}`);
  }
  if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) {
    throw new ValidationError('invalid_anchor_day', `anchor day must be 1..31, got ${String(anchor)}`);
  }
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12 + 12) % 12 + 1;
  if (targetYear < MIN_YEAR || targetYear > MAX_YEAR) {
    throw new ValidationError('date_out_of_range', `year ${targetYear} is outside ${MIN_YEAR}..${MAX_YEAR}`);
  }
  return format(targetYear, targetMonth, Math.min(anchor, daysInMonth(targetYear, targetMonth)));
}

/**
 * Due dates of `count` consecutive periods, the first being `first`.
 * Month-based periodicities keep the anchor day and clamp to month ends.
 * @param {string} first
 * @param {keyof typeof PERIODICITIES} periodicity
 * @param {number} count
 * @param {number} [anchorDay] Defaults to the day of `first`.
 * @returns {string[]}
 */
export function periodDates(first, periodicity, count, anchorDay) {
  const spec = hasPeriodicity(periodicity) ? PERIODICITIES[periodicity] : null;
  if (!spec) {
    throw new ValidationError('invalid_periodicity', `unknown periodicity ${String(periodicity)}`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new ValidationError('invalid_count', `count must be a non-negative integer, got ${String(count)}`);
  }
  parts(first);
  const dates = [];
  for (let index = 0; index < count; index += 1) {
    dates.push(
      spec.days === undefined
        ? addMonthsClamped(first, index * spec.months, anchorDay)
        : addDays(first, index * spec.days),
    );
  }
  return dates;
}

/**
 * Whole calendar days from `from` to `to` (positive when `to` is later).
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function daysBetween(from, to) {
  return Math.round((toMs(to) - toMs(from)) / MS_PER_DAY);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareIso(a, b) {
  const delta = toMs(a) - toMs(b);
  return delta < 0 ? -1 : delta > 0 ? 1 : 0;
}
