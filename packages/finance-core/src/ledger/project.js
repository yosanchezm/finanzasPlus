import { compareIso, isIsoDate } from '../calendar.js';
import { projectCard } from '../card/card.js';
import { ValidationError } from '../errors.js';
import { accrueLate, addLateNotices } from '../late/accrue.js';
import { lateEAOn, modalityOf, normalizeLate } from '../late/policy.js';
import { legalOf } from '../legal.js';
import { buildSchedule } from '../schedule/index.js';
import { parseTerms, validateTerms } from '../terms.js';
import { BUCKETS, emptyBuckets } from './allocate.js';
import { activeEvents, readEvents, sortEvents } from './events.js';
import { balanceAt, decorate, newRow, payBalanceOnly, payRows, paySplit, rowDue, rowOutstanding } from './rows.js';
import { applyAdjustment, applyChargeChange, applyExtra, applyLatePolicy, applyRateChange, applyRestructure } from './tail.js';

// project(debt, events, asOf) is a pure replay (AD1): terms plus the active
// events in chronological order give the whole state. Nothing is cached.

const PROJECTORS = new Map([['card', projectCard]]);

/**
 * Registers the projector for a debt kind (the `card` projector is built in). Pass `null`
 * to remove it. Kinds without a projector use the loan projector.
 * @param {string} kind
 * @param {((context: { debt: object, terms: object, events: object[], asOf: string, opts: object }) => object) | null} projector
 */
export function registerProjector(kind, projector) {
  if (projector === null) PROJECTORS.delete(kind);
  else if (typeof projector === 'function') PROJECTORS.set(kind, projector);
  else throw new ValidationError('invalid_projector', 'a projector must be a function or null');
}

/**
 * The kind of a debt (`card`, `consumer`...), read from its terms. Internal: not exported by the package barrel.
 * @param {object} debt A `debts` row.
 * @returns {string}
 * @throws {ValidationError} `invalid_debt` or whatever `validateTerms` throws
 */
export function debtKindOf(debt) {
  return debtTerms(debt).kind;
}

function debtTerms(debt) {
  if (debt?.terms) return validateTerms(debt.terms);
  if (typeof debt?.termsJson === 'string') return parseTerms(debt.termsJson);
  throw new ValidationError('invalid_debt', 'a debt needs terms or termsJson');
}

const costOf = (allocation) => (allocation ? allocation.charges + allocation.taxes + allocation.lateInterest + allocation.interest : 0);

function applyPayment(state, event) {
  const { bankSplit } = event.payload;
  if (state.work.system === 'none') return { allocation: payBalanceOnly(state, event.amountMinor, bankSplit) };
  const allocation = bankSplit
    ? paySplit(state.rows, bankSplit, event.id)
    : payRows(state.rows, event.amountMinor, state.work.allocationOrder, event.id);
  return { allocation };
}

// Handlers by event kind; each returns `{ allocation?, ... }` and may rewrite the state.
// Kinds without one (disbursement, charge) only appear in `applied`.
const HANDLERS = {
  payment: applyPayment,
  extra_payment: applyExtra,
  rate_change: applyRateChange,
  charge_change: applyChargeChange,
  restructure: applyRestructure,
  late_policy: applyLatePolicy,
  adjustment: applyAdjustment,
};

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
    remainingLateInterest: 0,
  };
  for (const row of rows) {
    const due = rowDue(row);
    totals.remainingInterest += due.interest;
    totals.remainingCharges += due.charges;
    totals.remainingTaxes += due.taxes;
    totals.remainingLateInterest += due.lateInterest;
  }
  return totals;
}

// A mortgage with mora always carries the informational Ley 546 notice, overdue or not.
function mortgageNotices(work, asOf, legal) {
  if (modalityOf(work) !== 'mortgage' || normalizeLate(work.late).mode === 'none') return [];
  return lateEAOn(work, asOf, legal).notices.filter((notice) => notice.code === 'late_mortgage_unverified');
}

// Replays the active events on a loan and accrues mora up to `asOf`; the state is returned as it stands.
function replayLoan({ debt, terms, events, asOf, legal }) {
  const state = {
    work: terms,
    offset: 0,
    rows: terms.system === 'none' ? [] : buildSchedule(terms).map(newRow),
    noneBalance: terms.system === 'none' ? terms.principalMinor : 0,
    termsVersion: debt.termsVersion ?? 1,
    lateClock: terms.openedOn,
    lateNotices: [],
  };
  const applied = [];
  const notices = [];
  for (const event of events) {
    accrueLate(state, event.effectiveOn, legal); // payments and changes take effect at the end of their date
    const { allocation = null, absorbed, ...extra } = HANDLERS[event.kind]?.(state, event) ?? {};
    applied.push({ eventId: event.id, kind: event.kind, effectiveOn: event.effectiveOn, allocation, costMinor: costOf(allocation), ...extra });
    if (allocation && allocation.surplus > 0) notices.push({ code: 'surplus', eventId: event.id, amountMinor: allocation.surplus });
    if (extra.driftMinor) notices.push({ code: 'drift', eventId: event.id, amountMinor: extra.driftMinor, absorbed });
  }
  accrueLate(state, asOf, legal);
  return { state, applied, notices };
}

function projectLoan(context) {
  const { asOf, legal } = context;
  const { state, applied, notices } = replayLoan(context);
  addLateNotices(state, mortgageNotices(state.work, asOf, legal));
  const plan = decorate(state.rows, asOf);
  const totals = totalsOf(applied, state.rows);
  return {
    asOf,
    termsVersion: state.termsVersion,
    terms: state.work,
    balanceMinor: balanceAt(state.rows, state.noneBalance, asOf),
    pastDueMinor: plan.reduce((sum, row) => sum + (row.status === 'pastDue' ? row.outstandingMinor : 0), 0),
    lateInterestMinor: totals.remainingLateInterest,
    remainingPeriods: state.rows.filter((row) => rowOutstanding(row) > 0).length,
    nextDue: plan.find((row) => row.status === 'pastDue' || row.status === 'partial' || row.status === 'due') ?? null,
    plan,
    applied,
    totals,
    notices: notices.concat(state.lateNotices),
  };
}

// Terms plus the active events dated on or before `asOf`, in chronological order.
function prepare(debt, events, asOf) {
  if (!isIsoDate(asOf)) throw new ValidationError('invalid_date', `asOf must be a real YYYY-MM-DD date, got ${String(asOf)}`);
  const terms = debtTerms(debt);
  const { known, unknown } = readEvents(events);
  const dated = known.filter((event) => compareIso(event.effectiveOn, asOf) <= 0);
  return { terms, active: sortEvents(activeEvents(dated)), unknown };
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
  const { terms, active, unknown } = prepare(debt, events, asOf);
  const projection = (PROJECTORS.get(terms.kind) ?? projectLoan)({ debt, terms, events: active, asOf, opts, legal: legalOf(debt, opts) });
  if (unknown.length === 0) return projection;
  // Events written by a newer build are skipped, not guessed at (AD1): one notice each, whatever their date.
  const skipped = unknown.map(({ id, kind }) => ({ code: 'unknown_event_kind', eventId: id, kind }));
  return { ...projection, notices: [...(projection.notices ?? []), ...skipped] };
}

/**
 * Replays a loan up to `asOf` and returns the working state (rows with their payments and accrued mora)
 * instead of a projection, for helpers that read figures the projection does not expose, such as
 * `restructureCarry`. Internal: not exported by the package barrel.
 * @param {object} debt A `debts` row (see `project`).
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {string} asOf `YYYY-MM-DD`.
 * @param {object} [opts] `legal` as in `project`.
 * @returns {({ terms: object, state: object, applied: object[] } | null)} `null` when the debt kind has its own
 *   projector (a card), because it has no installment rows to read.
 * @throws {ValidationError}
 */
export function replayLoanAt(debt, events, asOf, opts = {}) {
  const { terms, active } = prepare(debt, events, asOf);
  if (PROJECTORS.has(terms.kind)) return null;
  const { state, applied } = replayLoan({ debt, terms, events: active, asOf, legal: legalOf(debt, opts) });
  return { terms, state, applied };
}
