import { compareIso, isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { buildSchedule } from '../schedule/index.js';
import { parseTerms, validateTerms } from '../terms.js';
import { BUCKETS, emptyBuckets } from './allocate.js';
import { activeEvents, sortEvents, validateEvent } from './events.js';
import { balanceAt, decorate, newRow, payRows, paySplit, rowDue, rowOutstanding } from './rows.js';

// project(debt, events, asOf) is a pure replay (AD1): terms plus the active
// events in chronological order give the whole state. Nothing is cached.

const PROJECTORS = new Map();

/**
 * Registers the projector for a debt kind (for example `card`, S7). Pass `null`
 * to remove it. Kinds without a projector use the loan projector.
 * @param {string} kind
 * @param {((context: { debt: object, terms: object, events: object[], asOf: string, opts: object }) => object) | null} projector
 */
export function registerProjector(kind, projector) {
  if (projector === null) PROJECTORS.delete(kind);
  else if (typeof projector === 'function') PROJECTORS.set(kind, projector);
  else throw new ValidationError('invalid_projector', 'a projector must be a function or null');
}

function debtTerms(debt) {
  if (debt?.terms) return validateTerms(debt.terms);
  if (typeof debt?.termsJson === 'string') return parseTerms(debt.termsJson);
  throw new ValidationError('invalid_debt', 'a debt needs terms or termsJson');
}

const costOf = (allocation) => (allocation ? allocation.charges + allocation.taxes + allocation.lateInterest + allocation.interest : 0);

function payBalanceOnly(state, amountMinor, split) {
  const stated = { ...emptyBuckets(), ...(split ?? { principal: amountMinor }) };
  const principal = Math.min(stated.principal, state.noneBalance);
  state.noneBalance -= principal;
  const result = { ...stated, principal };
  return { ...result, surplus: amountMinor - BUCKETS.reduce((sum, key) => sum + result[key], 0) };
}

function applyPayment(state, event) {
  const { bankSplit } = event.payload;
  if (state.work.system === 'none') return { allocation: payBalanceOnly(state, event.amountMinor, bankSplit) };
  const allocation = bankSplit
    ? paySplit(state.rows, bankSplit, event.id)
    : payRows(state.rows, event.amountMinor, state.work.allocationOrder, event.id);
  return { allocation };
}

// Handlers by event kind; kinds without one (disbursement, charge) only appear in `applied`.
const HANDLERS = { payment: applyPayment };

function totalsOf(applied, rows) {
  const paid = emptyBuckets();
  for (const entry of applied) {
    if (entry.allocation) for (const key of BUCKETS) paid[key] += entry.allocation[key];
  }
  const totals = {
    interestPaid: paid.interest,
    chargesPaid: paid.charges,
    taxesPaid: paid.taxes,
    lateInterestPaid: paid.lateInterest,
    principalPaid: paid.principal,
    remainingInterest: 0,
    remainingCharges: 0,
    remainingTaxes: 0,
  };
  for (const row of rows) {
    const due = rowDue(row);
    totals.remainingInterest += due.interest;
    totals.remainingCharges += due.charges;
    totals.remainingTaxes += due.taxes;
  }
  return totals;
}

function projectLoan({ debt, terms, events, asOf }) {
  const state = {
    work: terms,
    rows: terms.system === 'none' ? [] : buildSchedule(terms).map(newRow),
    noneBalance: terms.system === 'none' ? terms.principalMinor : 0,
    termsVersion: debt.termsVersion ?? 1,
  };
  const applied = [];
  const notices = [];
  for (const event of events) {
    const { allocation = null, ...extra } = HANDLERS[event.kind]?.(state, event) ?? {};
    applied.push({ eventId: event.id, kind: event.kind, effectiveOn: event.effectiveOn, allocation, costMinor: costOf(allocation), ...extra });
    if (allocation && allocation.surplus > 0) notices.push({ code: 'surplus', eventId: event.id, amountMinor: allocation.surplus });
  }
  const plan = decorate(state.rows, asOf);
  return {
    asOf,
    termsVersion: state.termsVersion,
    terms: state.work,
    balanceMinor: balanceAt(state.rows, state.noneBalance, asOf),
    pastDueMinor: plan.reduce((sum, row) => sum + (row.status === 'pastDue' ? row.outstandingMinor : 0), 0),
    remainingPeriods: state.rows.filter((row) => rowOutstanding(row) > 0).length,
    nextDue: plan.find((row) => row.status === 'pastDue' || row.status === 'partial' || row.status === 'due') ?? null,
    plan,
    applied,
    totals: totalsOf(applied, state.rows),
    notices,
  };
}

/**
 * Projects a debt as of a date: balance, next due, past due, remaining term and
 * the FULL plan with a status per row (`paid`, `partial`, `due`, `pastDue`,
 * `future`). Pure and deterministic: events dated after `asOf` and voided
 * events are ignored, and the storage order of the events does not matter.
 * @param {object} debt A `debts` row: `terms` (object) or `termsJson`, optional `termsVersion`.
 * @param {object[]} events `debt_events` rows (any order).
 * @param {string} asOf `YYYY-MM-DD`.
 * @param {object} [opts] Passed through to the projector for the debt kind.
 * @returns {object} Projection
 * @throws {ValidationError}
 */
export function project(debt, events, asOf, opts = {}) {
  if (!isIsoDate(asOf)) throw new ValidationError('invalid_date', `asOf must be a real YYYY-MM-DD date, got ${String(asOf)}`);
  const terms = debtTerms(debt);
  const dated = events.map(validateEvent).filter((event) => compareIso(event.effectiveOn, asOf) <= 0);
  const active = sortEvents(activeEvents(dated));
  return (PROJECTORS.get(terms.kind) ?? projectLoan)({ debt, terms, events: active, asOf, opts });
}
