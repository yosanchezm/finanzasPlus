import { compareIso, isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { assertMinor } from '../money.js';
import { normalizeRate } from '../rates.js';
import { normalizeCharges, validateTerms } from '../terms.js';
import { BUCKETS } from './allocate.js';

/** Event kinds; `charge` (card purchases, AD13) is the only one beyond the spec's list. */
export const EVENT_KINDS = Object.freeze([
  'disbursement',
  'payment',
  'extra_payment',
  'rate_change',
  'charge_change',
  'restructure',
  'adjustment',
  'charge',
  'void',
]);

const STRATEGIES = ['reduce_term', 'reduce_installment', 'advance_installments'];
const MODES = ['keep_term', 'keep_installment'];
const TRANCHES = ['revolving', 'deferred', 'advance'];
// Kinds that carry money; the rest are recorded with amountMinor 0.
const WITH_AMOUNT = ['disbursement', 'payment', 'extra_payment', 'charge'];

const invalid = (message) => new ValidationError('invalid_event', message);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isMinor = (value) => Number.isSafeInteger(value) && value >= 0;

function parsePayload(event) {
  const raw = event.payload ?? (event.payloadJson === undefined || event.payloadJson === '' ? {} : event.payloadJson);
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch {
      throw invalid('payloadJson is not valid JSON');
    }
  }
  if (!isObject(payload)) throw invalid('the payload must be an object');
  return payload;
}

function bankSplit(split, amountMinor) {
  const bad = (message) => new ValidationError('invalid_bank_split', message);
  if (!isObject(split) || Object.keys(split).some((key) => !BUCKETS.includes(key) || !isMinor(split[key]))) {
    throw bad(`bankSplit needs whole pesos >= 0 in ${BUCKETS.join(', ')}`);
  }
  const sum = Object.keys(split).reduce((total, key) => total + split[key], 0);
  if (sum !== amountMinor) throw bad(`bankSplit adds up to ${sum}, but the payment is ${amountMinor}`);
  return { ...split };
}

function adjustment(payload) {
  const result = {};
  if (payload.balanceMinor !== undefined) {
    if (!isMinor(payload.balanceMinor)) throw invalid('adjustment balanceMinor must be whole pesos >= 0');
    result.balanceMinor = payload.balanceMinor;
  }
  if (payload.minimumDueMinor !== undefined) {
    if (!isMinor(payload.minimumDueMinor)) throw invalid('adjustment minimumDueMinor must be whole pesos >= 0');
    result.minimumDueMinor = payload.minimumDueMinor;
  }
  if (payload.dueOn !== undefined) {
    if (!isIsoDate(payload.dueOn)) throw invalid('adjustment dueOn must be a real YYYY-MM-DD date');
    result.dueOn = payload.dueOn;
  }
  if (payload.trancheBalances !== undefined) {
    const balances = payload.trancheBalances;
    if (!isObject(balances) || Object.keys(balances).some((id) => !isMinor(balances[id]))) {
      throw invalid('adjustment trancheBalances must map tranche ids to whole pesos >= 0');
    }
    result.trancheBalances = { ...balances };
  }
  result.note = typeof payload.note === 'string' ? payload.note : '';
  return result;
}

function normalizePayload(kind, payload, amountMinor) {
  switch (kind) {
    case 'payment': {
      return payload.bankSplit === undefined ? {} : { bankSplit: bankSplit(payload.bankSplit, amountMinor) };
    }
    case 'extra_payment': {
      if (!STRATEGIES.includes(payload.strategy)) throw invalid(`extra_payment strategy must be one of ${STRATEGIES.join(', ')}`);
      return { strategy: payload.strategy };
    }
    case 'rate_change': {
      if (!MODES.includes(payload.mode)) throw invalid(`rate_change mode must be one of ${MODES.join(', ')}`);
      return { rate: normalizeRate(payload.rate), mode: payload.mode };
    }
    case 'charge_change': {
      if (!Array.isArray(payload.charges)) throw invalid('charge_change needs a charges list');
      return { charges: normalizeCharges(payload.charges) };
    }
    case 'restructure': {
      return { terms: validateTerms(payload.terms) };
    }
    case 'adjustment': {
      return adjustment(payload);
    }
    case 'charge': {
      if (!TRANCHES.includes(payload.trancheType)) throw invalid(`charge trancheType must be one of ${TRANCHES.join(', ')}`);
      if (typeof payload.label !== 'string' || payload.label === '') throw invalid('charge needs a label');
      const result = { trancheType: payload.trancheType, label: payload.label };
      if (payload.n !== undefined) {
        if (!Number.isSafeInteger(payload.n) || payload.n < 1) throw invalid('charge n must be a positive whole number');
        result.n = payload.n;
      }
      if (payload.rate !== undefined) result.rate = normalizeRate(payload.rate);
      return result;
    }
    case 'void': {
      if (typeof payload.targetEventId !== 'string' || payload.targetEventId === '') throw invalid('void needs a targetEventId');
      return { targetEventId: payload.targetEventId, reason: typeof payload.reason === 'string' ? payload.reason : '' };
    }
    default: {
      return {};
    }
  }
}

/**
 * Validates a stored event row (Appwrite shape: `$id`, `$createdAt`,
 * `payloadJson`) or an already normalized one, and returns a normalized copy.
 * @param {object} input
 * @returns {{ id: string, debtId?: string, kind: string, effectiveOn: string, amountMinor: number, payload: object,
 *   createdAt: string, actorId?: string, source?: string, dedupeKey?: string }}
 * @throws {ValidationError} `invalid_event`, `invalid_date`, `invalid_minor` or `invalid_bank_split`
 */
export function validateEvent(input) {
  if (!isObject(input)) throw invalid('an event must be an object');
  const id = input.id ?? input.$id;
  if (typeof id !== 'string' || id === '') throw invalid('an event needs a non-empty id');
  if (!EVENT_KINDS.includes(input.kind)) throw invalid(`event kind must be one of ${EVENT_KINDS.join(', ')}, got ${String(input.kind)}`);
  if (!isIsoDate(input.effectiveOn)) throw new ValidationError('invalid_date', `effectiveOn must be a real YYYY-MM-DD date, got ${String(input.effectiveOn)}`);
  const amountMinor = assertMinor(input.amountMinor, 'amountMinor');
  const needsAmount = WITH_AMOUNT.includes(input.kind);
  if (amountMinor < 0 || (needsAmount && amountMinor === 0) || (!needsAmount && amountMinor !== 0)) {
    throw invalid(`a ${input.kind} event needs amountMinor ${needsAmount ? '> 0' : '= 0'}, got ${amountMinor}`);
  }
  return {
    id,
    debtId: input.debtId,
    kind: input.kind,
    effectiveOn: input.effectiveOn,
    amountMinor,
    payload: normalizePayload(input.kind, parsePayload(input), amountMinor),
    createdAt: input.createdAt ?? input.$createdAt ?? '',
    actorId: input.actorId,
    source: input.source,
    dedupeKey: input.dedupeKey,
  };
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Chronological order: effectiveOn, then creation time, then id, so the result
 * never depends on the storage order. Accepts stored or normalized events.
 * @param {object[]} events
 * @returns {object[]} A new array of normalized events.
 */
export function sortEvents(events) {
  return events
    .map(validateEvent)
    .sort((a, b) => compareIso(a.effectiveOn, b.effectiveOn) || compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
}

/**
 * Drops voided events and the void events themselves. A void that targets a
 * missing event or another void has no effect (voids cannot be undone).
 * @param {object[]} events
 * @returns {object[]} Normalized events in their input order.
 */
export function activeEvents(events) {
  const normalized = events.map(validateEvent);
  const voids = normalized.filter((event) => event.kind === 'void');
  const voidIds = new Set(voids.map((event) => event.id));
  const voided = new Set(voids.map((event) => event.payload.targetEventId).filter((target) => !voidIds.has(target)));
  return normalized.filter((event) => event.kind !== 'void' && !voided.has(event.id));
}
