import { isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { DEFAULT_LEGAL, capOn } from '../legal.js';
import { normalizeRate, toEffectiveAnnual } from '../rates.js';

// Late interest (mora) policy: which rate applies on a given day. Pure and dependency-free.
// A policy is `terms.late = { mode, rate?, multiple?, graceDays }`. An absent policy means mode `none`.
// Notices are structured (`code` plus fields), informational, and never block.

/** Mora modes, in design order. */
export const LATE_MODES = Object.freeze(['none', 'usury', 'fixed', 'contract_multiple']);

const MAX_GRACE_DAYS = 90;
const MAX_MULTIPLE = 3;
const DAYS_PER_YEAR = 365;
// Kinds that default to mora at the usury cap; every other kind defaults to none (family, informal, other).
const USURY_DEFAULT_KINDS = Object.freeze(['consumer', 'vehicle', 'libranza', 'leasing', 'mortgage', 'card']);

const invalidLate = (message) => new ValidationError('invalid_late', message);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function normalizeGraceDays(graceDays) {
  if (graceDays === undefined) return 0;
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > MAX_GRACE_DAYS) {
    throw invalidLate(`graceDays must be a whole number of days in 0..${MAX_GRACE_DAYS}, got ${String(graceDays)}`);
  }
  return graceDays;
}

/**
 * Validates a mora policy and returns it in its normalized form: `{ mode, graceDays }` plus the
 * mode's own field (`rate` for `fixed`, `multiple` for `contract_multiple`). Fields the mode does
 * not use are dropped. An absent policy (`undefined`) is mode `none`. Never mutates its input.
 * @param {object | undefined} input
 * @returns {{ mode: string, graceDays: number, rate?: object, multiple?: number }}
 * @throws {ValidationError} `invalid_late` (or `invalid_rate` for a malformed fixed rate)
 */
export function normalizeLate(input) {
  if (input === undefined) return { mode: 'none', graceDays: 0 };
  if (!isObject(input)) throw invalidLate('the late policy must be an object');
  if (!LATE_MODES.includes(input.mode)) {
    throw invalidLate(`late mode must be one of ${LATE_MODES.join(', ')}, got ${String(input.mode)}`);
  }
  const late = { mode: input.mode };
  if (input.mode === 'fixed') {
    if (input.rate === undefined) throw invalidLate('a fixed late policy needs a rate');
    late.rate = normalizeRate(input.rate);
    if (!(toEffectiveAnnual(late.rate) > 0)) throw invalidLate('a fixed late rate must be above 0');
  } else if (input.mode === 'contract_multiple') {
    const { multiple } = input;
    if (typeof multiple !== 'number' || !(multiple > 0 && multiple <= MAX_MULTIPLE)) {
      throw invalidLate(`a contract_multiple policy needs a multiple above 0 and up to ${MAX_MULTIPLE}, got ${String(multiple)}`);
    }
    late.multiple = multiple;
  }
  late.graceDays = normalizeGraceDays(input.graceDays);
  return late;
}

/**
 * The legal modality that picks the usury cap: `terms.modality` when set, else `mortgage`
 * for mortgages and `consumer` for every other kind.
 * @param {{ kind?: string, modality?: string }} terms
 * @returns {string}
 */
export function modalityOf(terms) {
  return terms.modality ?? (terms.kind === 'mortgage' ? 'mortgage' : 'consumer');
}

/**
 * The mora policy a new debt of this kind starts with: `usury` for bank kinds and cards,
 * `none` for family, informal, other and unknown kinds. Returns a fresh object.
 * @param {string} kind
 * @returns {{ mode: string, graceDays: number }}
 */
export function defaultLateFor(kind) {
  return { mode: USURY_DEFAULT_KINDS.includes(kind) ? 'usury' : 'none', graceDays: 0 };
}

/**
 * Simple daily rate for an EA percent: (1 + EA)^(1/365) - 1, as a fraction (actual/365).
 * @param {number} eaPercent For example 28.59.
 * @returns {number} For example 0.00068917.
 * @throws {ValidationError} `invalid_rate` when not a finite number >= 0
 */
export function dailyRate(eaPercent) {
  if (typeof eaPercent !== 'number' || !Number.isFinite(eaPercent) || eaPercent < 0) {
    throw new ValidationError('invalid_rate', `an EA rate must be a finite number >= 0, got ${String(eaPercent)}`);
  }
  return (1 + eaPercent / 100) ** (1 / DAYS_PER_YEAR) - 1;
}

const lateNotice = (code, modality, asOf, extra = {}) => ({ code, severity: 'info', blocking: false, modality, asOf, ...extra });

function policyEA(late, contractEA) {
  if (late.mode === 'fixed') return toEffectiveAnnual(late.rate);
  if (late.mode === 'contract_multiple') return late.multiple * contractEA;
  return contractEA; // `usury` without a known cap falls back to the contract rate
}

/**
 * The annual rate (% EA) mora accrues at on `day`, and the notices that day raised.
 * EA = min(policy rate, cap of that day for the modality); `usury` is the cap itself.
 * With no cap known at all the policy rate is used (the contract EA for `usury`) plus
 * `late_cap_unknown`; a cap carried forward raises `late_cap_stale`. A mortgage with mora
 * always raises `late_mortgage_unverified` (Ley 546 rules are not applied).
 * @param {object} terms Debt terms: `kind`, `rate`, optional `modality` and `late`.
 * @param {string} day ISO date.
 * @param {{ usuryTable?: readonly object[] }} [legal] A resolved legal table (default: the code tables).
 * @returns {{ ea: number, notices: object[] }}
 * @throws {ValidationError} `invalid_date` for a bad day, `invalid_late` for a malformed policy
 */
export function lateEAOn(terms, day, legal) {
  if (!isIsoDate(day)) throw new ValidationError('invalid_date', `day must be a real YYYY-MM-DD date, got ${String(day)}`);
  const late = normalizeLate(terms.late);
  if (late.mode === 'none') return { ea: 0, notices: [] };
  const modality = modalityOf(terms);
  const cap = capOn((legal ?? DEFAULT_LEGAL).usuryTable, modality, day);
  const policy = policyEA(late, toEffectiveAnnual(terms.rate));
  const notices = [];
  let ea = policy;
  if (cap === null) {
    notices.push(lateNotice('late_cap_unknown', modality, day));
  } else {
    ea = late.mode === 'usury' ? cap.capEA : Math.min(policy, cap.capEA);
    if (cap.stale) notices.push(lateNotice('late_cap_stale', modality, day, { lastValidTo: cap.lastValidTo }));
  }
  if (modality === 'mortgage') notices.push(lateNotice('late_mortgage_unverified', modality, day));
  return { ea, notices };
}

/**
 * `lateEAOn` plus the simple daily rate of that EA.
 * @param {object} terms
 * @param {string} day ISO date.
 * @param {{ usuryTable?: readonly object[] }} [legal]
 * @returns {{ ea: number, daily: number, notices: object[] }}
 */
export function lateRateOn(terms, day, legal) {
  const { ea, notices } = lateEAOn(terms, day, legal);
  return { ea, daily: dailyRate(ea), notices };
}
