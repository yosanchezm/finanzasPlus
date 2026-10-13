import { isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { normalizeRate } from '../rates.js';

// Card configuration inside DebtTerms (`terms.card`). Statement and due days
// clamp to the month end at use; `deferred` holds the installment purchases
// that already existed when the card was registered.

/** Minimum-payment rules (see `minimumPayment`). */
export const MIN_RULES = Object.freeze(['pct_balance', 'interest_fees_plus_pct', 'installments_due']);
export const MAX_OPENING_PURCHASES = 24;
export const MAX_INSTALLMENTS = 120;

const bad = (message) => new ValidationError('invalid_card', message);
const isInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

function normalizePurchase(item, earlier) {
  if (item === null || typeof item !== 'object') throw bad('an opening purchase must be an object');
  if (typeof item.id !== 'string' || item.id === '' || item.id === 'revolving' || earlier.some((other) => other.id === item.id)) {
    throw bad(`an opening purchase needs a unique id other than "revolving", got ${String(item.id)}`);
  }
  if (!isInteger(item.principalMinor, 1, Number.MAX_SAFE_INTEGER)) throw bad(`purchase ${item.id} principalMinor must be positive whole pesos`);
  if (!isInteger(item.n, 2, MAX_INSTALLMENTS)) throw bad(`purchase ${item.id} needs 2..${MAX_INSTALLMENTS} installments (a single one is an ordinary purchase)`);
  if (item.rate === undefined) throw bad(`purchase ${item.id} needs the rate fixed at purchase (0% is allowed)`);
  if (item.openedOn !== undefined && !isIsoDate(item.openedOn)) throw bad(`purchase ${item.id} openedOn must be a real YYYY-MM-DD date`);
  const normalized = {
    id: item.id,
    label: typeof item.label === 'string' && item.label !== '' ? item.label : item.id,
    principalMinor: item.principalMinor,
    n: item.n,
    rate: normalizeRate(item.rate),
  };
  if (item.openedOn !== undefined) normalized.openedOn = item.openedOn;
  return normalized;
}

/**
 * Validates the card block of the terms and returns a normalized copy with
 * defaults applied (`minPayment`: 5% of the revolving balance, no floor).
 * @param {object} input
 * @returns {{ statementDay: number, dueDay: number, minPayment: object, deferred: object[], limitMinor?: number, advanceRate?: object }}
 * @throws {ValidationError} `invalid_card`
 */
export function normalizeCard(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw bad('a card debt needs its card settings (statement and due day)');
  if (!isInteger(input.statementDay, 1, 31) || !isInteger(input.dueDay, 1, 31)) throw bad('statementDay and dueDay must be whole days 1..31');
  const { rule = 'interest_fees_plus_pct', pct = 5, floorMinor = 0 } = input.minPayment ?? {};
  if (!MIN_RULES.includes(rule)) throw bad(`minPayment.rule must be one of ${MIN_RULES.join(', ')}, got ${String(rule)}`);
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) throw bad(`minPayment.pct must be 0..100, got ${String(pct)}`);
  if (!isInteger(floorMinor, 0, Number.MAX_SAFE_INTEGER)) throw bad('minPayment.floorMinor must be whole pesos >= 0');
  const card = { statementDay: input.statementDay, dueDay: input.dueDay, minPayment: { rule, pct, floorMinor }, deferred: [] };
  if (input.limitMinor !== undefined) {
    if (!isInteger(input.limitMinor, 1, Number.MAX_SAFE_INTEGER)) throw bad('limitMinor must be positive whole pesos');
    card.limitMinor = input.limitMinor;
  }
  if (input.advanceRate !== undefined) card.advanceRate = normalizeRate(input.advanceRate);
  const deferred = input.deferred ?? [];
  if (!Array.isArray(deferred) || deferred.length > MAX_OPENING_PURCHASES) throw bad(`deferred must list at most ${MAX_OPENING_PURCHASES} purchases`);
  for (const item of deferred) card.deferred.push(normalizePurchase(item, card.deferred));
  return card;
}
