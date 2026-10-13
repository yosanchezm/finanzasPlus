import { compareIso, hasPeriodicity, isIsoDate } from './calendar.js';
import { TermsTooLarge, ValidationError } from './errors.js';
import { assertMinor } from './money.js';
import { normalizeRate } from './rates.js';

// DebtTerms are persisted as JSON in `debts.termsJson` (s8000), so every
// document carries `schemaVersion` and goes through `validateTerms` on the way
// in and out. Amounts are integer pesos; rates keep the lender's own wording.

export const TERMS_SCHEMA_VERSION = 1;
/** Size of the `termsJson` column; serialization over this throws `TermsTooLarge`. */
export const TERMS_MAX_CHARS = 8000;

const MAX_PERIODS = 2000;
const DEBT_KINDS = ['consumer', 'vehicle', 'libranza', 'mortgage', 'leasing', 'family', 'informal', 'card', 'other'];
const SYSTEMS = ['french', 'german', 'bullet', 'interest_only', 'manual', 'none'];
const GRACE_SYSTEMS = ['french', 'german'];
const GRACE_TYPES = ['total', 'principal'];
const CHARGE_KINDS = ['insurance', 'fee', 'tax', 'other'];
const CHARGE_BASES = ['fixed', 'pctOutstanding', 'pctOriginal', 'pctOfBase', 'pctOfSubtotal', 'pctOfCharge'];
const CHARGE_CADENCES = ['per_installment', 'annual', 'once'];
const CHARGE_DISPLAYS = ['itemized', 'bundled'];

const fail = (code, message) => new ValidationError(code, message);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isInteger = (value, min) => Number.isSafeInteger(value) && value >= min;

function oneOf(value, allowed, label, code = 'invalid_terms') {
  if (!allowed.includes(value)) throw fail(code, `${label} must be one of ${allowed.join(', ')}, got ${String(value)}`);
  return value;
}

function requireDate(value, label) {
  if (!isIsoDate(value)) throw fail('invalid_date', `${label} must be a real YYYY-MM-DD date, got ${String(value)}`);
  return value;
}

function normalizeCharge(charge, earlier) {
  const bad = (message) => fail('invalid_charge', message);
  if (!isObject(charge)) throw bad('a charge must be an object');
  if (typeof charge.id !== 'string' || charge.id === '') throw bad('a charge needs a non-empty string id');
  if (earlier.some((other) => other.id === charge.id)) throw bad(`duplicate charge id ${charge.id}`);
  const kind = oneOf(charge.kind, CHARGE_KINDS, `charge ${charge.id} kind`, 'invalid_charge');
  const basis = oneOf(charge.basis, CHARGE_BASES, `charge ${charge.id} basis`, 'invalid_charge');
  const cadence = oneOf(charge.cadence ?? 'per_installment', CHARGE_CADENCES, `charge ${charge.id} cadence`, 'invalid_charge');
  const display = oneOf(charge.display ?? 'itemized', CHARGE_DISPLAYS, `charge ${charge.id} display`, 'invalid_charge');
  const { value } = charge;
  const validValue = basis === 'fixed' ? isInteger(value, 0) : typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!validValue) throw bad(`charge ${charge.id} value must be ${basis === 'fixed' ? 'whole pesos' : 'a percentage'} >= 0`);
  const fromPeriod = charge.fromPeriod ?? 1;
  const toPeriod = charge.toPeriod ?? null;
  if (!isInteger(fromPeriod, 1) || (toPeriod !== null && !isInteger(toPeriod, fromPeriod))) {
    throw bad(`charge ${charge.id} needs 1 <= fromPeriod <= toPeriod`);
  }
  const normalized = {
    id: charge.id,
    kind,
    label: typeof charge.label === 'string' && charge.label !== '' ? charge.label : charge.id,
    basis,
    value,
    cadence,
    fromPeriod,
    toPeriod,
    display,
  };
  if (basis === 'pctOfBase') {
    if (!isInteger(charge.baseMinor, 1)) throw bad(`charge ${charge.id} (pctOfBase) needs a positive baseMinor`);
    normalized.baseMinor = charge.baseMinor;
  }
  if (basis === 'pctOfCharge') {
    // Referencing only earlier charges keeps evaluation acyclic and ordered.
    const target = earlier.find((other) => other.id === charge.refId);
    if (!target || target.basis === 'pctOfSubtotal') {
      throw bad(`charge ${charge.id} (pctOfCharge) must reference an earlier charge that is not pctOfSubtotal`);
    }
    normalized.refId = charge.refId;
  }
  return normalized;
}

export function normalizeCharges(charges) {
  if (charges === undefined) return [];
  if (!Array.isArray(charges)) throw fail('invalid_charge', 'charges must be an array');
  const normalized = [];
  for (const charge of charges) normalized.push(normalizeCharge(charge, normalized));
  return normalized;
}

function normalizeManualPlan(plan) {
  const bad = (message) => fail('invalid_manual_plan', message);
  if (!Array.isArray(plan) || plan.length === 0 || plan.length > MAX_PERIODS) {
    throw bad(`manualPlan must list 1..${MAX_PERIODS} [dueOn, amountMinor] pairs`);
  }
  return plan.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !isIsoDate(entry[0]) || !isInteger(entry[1], 1)) {
      throw bad(`manualPlan[${index}] must be [YYYY-MM-DD, positive whole pesos]`);
    }
    if (index > 0 && compareIso(plan[index - 1][0], entry[0]) >= 0) {
      throw bad('manualPlan dates must be strictly increasing');
    }
    return [entry[0], entry[1]];
  });
}

/**
 * Validates debt terms and returns a normalized copy: defaults applied,
 * `schemaVersion` stamped, rates in their structured form. Never mutates input.
 * @param {object} input
 * @returns {object} DebtTerms
 * @throws {ValidationError} with a stable `code`
 */
export function validateTerms(input) {
  if (!isObject(input)) throw fail('invalid_terms', 'terms must be an object');
  const version = input.schemaVersion ?? TERMS_SCHEMA_VERSION;
  if (version !== TERMS_SCHEMA_VERSION) {
    throw fail('unsupported_schema_version', `terms schemaVersion ${String(version)} is not supported`);
  }
  const kind = oneOf(input.kind, DEBT_KINDS, 'kind');
  const unit = input.unit ?? 'COP';
  if (unit !== 'COP') throw fail('invalid_terms', `unit must be COP, got ${String(unit)}`);
  const principalMinor = assertMinor(input.principalMinor, 'principalMinor');
  if (principalMinor < 0 || (principalMinor === 0 && kind !== 'card')) {
    throw fail('invalid_principal', `principalMinor must be positive, got ${principalMinor}`);
  }
  const system = oneOf(input.system, SYSTEMS, 'system');
  const terms = {
    schemaVersion: TERMS_SCHEMA_VERSION,
    kind,
    unit,
    principalMinor,
    openedOn: requireDate(input.openedOn, 'openedOn'),
    rate: normalizeRate(input.rate),
    system,
  };

  const scheduled = system !== 'none';
  const periodicity = input.periodicity ?? (scheduled ? undefined : 'monthly');
  if (!hasPeriodicity(periodicity)) throw fail('invalid_terms', `periodicity is not supported: ${String(periodicity)}`);
  terms.periodicity = periodicity;
  if (system === 'manual') {
    terms.manualPlan = normalizeManualPlan(input.manualPlan);
    terms.n = terms.manualPlan.length;
    terms.firstDueOn = terms.manualPlan[0][0];
  } else if (scheduled) {
    if (!isInteger(input.n, 1) || input.n > MAX_PERIODS) throw fail('invalid_terms', `n must be a whole number of periods in 1..${MAX_PERIODS}`);
    terms.n = input.n;
    terms.firstDueOn = requireDate(input.firstDueOn, 'firstDueOn');
  }
  if (input.dueDay !== undefined) {
    if (!isInteger(input.dueDay, 1) || input.dueDay > 31) throw fail('invalid_terms', `dueDay must be 1..31, got ${String(input.dueDay)}`);
    terms.dueDay = input.dueDay;
  }

  if (input.grace !== undefined) {
    const { periods, type } = input.grace ?? {};
    if (!isInteger(periods, 0) || !GRACE_TYPES.includes(type) || (scheduled && periods >= terms.n)) {
      throw fail('invalid_grace', 'grace needs whole periods below n and type total or principal');
    }
    if (periods > 0) {
      if (!GRACE_SYSTEMS.includes(system)) throw fail('grace_unsupported', `grace is not supported for the ${system} system`);
      terms.grace = { periods, type };
    }
  }
  if (input.balloonMinor !== undefined && input.balloonMinor !== 0) {
    if (system !== 'interest_only') throw fail('balloon_unsupported', `a balloon is only supported by the interest_only system`);
    if (!isInteger(input.balloonMinor, 1) || input.balloonMinor > principalMinor || (terms.n === 1 && input.balloonMinor !== principalMinor)) {
      throw fail('invalid_balloon', 'balloonMinor must be positive, not above the principal, and equal to it when n is 1');
    }
    terms.balloonMinor = input.balloonMinor;
  }

  terms.charges = normalizeCharges(input.charges);
  if (input.allocationOrder !== undefined) {
    if (!Array.isArray(input.allocationOrder) || input.allocationOrder.some((item) => typeof item !== 'string')) {
      throw fail('invalid_terms', 'allocationOrder must be a list of strings');
    }
    terms.allocationOrder = input.allocationOrder.slice();
  }
  const penalty = input.prepaymentPenaltyPct ?? 0;
  if (typeof penalty !== 'number' || !Number.isFinite(penalty) || penalty < 0 || penalty > 100) {
    throw fail('invalid_terms', `prepaymentPenaltyPct must be 0..100, got ${String(penalty)}`);
  }
  terms.prepaymentPenaltyPct = penalty;
  const roundingUnit = input.roundingUnit ?? 1;
  if (!isInteger(roundingUnit, 1)) throw fail('invalid_terms', `roundingUnit must be a positive whole number, got ${String(roundingUnit)}`);
  terms.roundingUnit = roundingUnit;
  if (input.lateRate !== undefined) terms.lateRate = normalizeRate(input.lateRate);
  if (input.card !== undefined) {
    if (!isObject(input.card)) throw fail('invalid_terms', 'card must be an object');
    terms.card = JSON.parse(JSON.stringify(input.card));
  }
  return terms;
}

/**
 * Validates and serializes terms for `debts.termsJson`.
 * @param {object} terms
 * @returns {string}
 * @throws {TermsTooLarge} when the JSON exceeds `TERMS_MAX_CHARS`
 */
export function serializeTerms(terms) {
  const text = JSON.stringify(validateTerms(terms));
  if (text.length > TERMS_MAX_CHARS) {
    throw new TermsTooLarge(`terms take ${text.length} characters; the limit is ${TERMS_MAX_CHARS}`);
  }
  return text;
}

// Migrations upgrade a parsed document one version at a time. Documents written
// before versioning existed have no `schemaVersion` and count as version 0.
const MIGRATIONS = [(document) => ({ ...document, schemaVersion: 1 })];

/**
 * Parses and validates stored terms, migrating older schema versions.
 * @param {string} text
 * @returns {object} DebtTerms at the current schema version
 */
export function parseTerms(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw fail('invalid_terms_json', 'terms are not valid JSON');
  }
  if (!isObject(document)) throw fail('invalid_terms', 'terms must be an object');
  let version = document.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > TERMS_SCHEMA_VERSION) {
    throw fail('unsupported_schema_version', `terms schemaVersion ${String(version)} is not supported`);
  }
  while (version < TERMS_SCHEMA_VERSION) {
    document = MIGRATIONS[version](document);
    version = document.schemaVersion;
  }
  return validateTerms(document);
}
