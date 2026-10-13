import { compareIso } from '../calendar.js';
import { addCharges, buildSchedule } from '../schedule/index.js';
import { balanceAt, newRow, payBalanceOnly, payRows, rowDue, rowOutstanding } from './rows.js';

// Events that rewrite the plan (extra payments, rate and charge changes,
// restructures, adjustments). Each handler mutates the projection state and
// returns `{ allocation?, ... }` for the `applied` list. Rows already due or
// with a payment applied keep their figures: only the tail is rebuilt, from the
// scheduled opening balance of its first row.
//
// state = { work, offset, rows, noneBalance, termsVersion }
//   work   terms currently in force (rate, charges and term follow the changes)
//   offset rows that belong to earlier terms; `work` period p is plan row offset + p

/**
 * Index of the first row a change dated `date` may still rewrite: due after the
 * date and after every row that already has a payment. -1 when there is none.
 */
export function tailStart(rows, date) {
  let start = rows.findIndex((row) => compareIso(row.dueOn, date) > 0);
  if (start < 0) return -1;
  for (let index = rows.length - 1; index >= start; index -= 1) {
    if (rows[index].paidByEventIds.length > 0) {
      start = index + 1;
      break;
    }
  }
  return start < rows.length ? start : -1;
}

// The French level installment in force at `index`; other systems keep their term.
function levelInstallment(state, index) {
  if (state.work.system !== 'french') return undefined;
  const amortizing = state.rows.slice(index).find((row) => row.principalMinor > 0);
  return amortizing?.installmentMinor;
}

function resized(work, count) {
  if (count < 1) return work;
  return work.system === 'manual' ? { ...work, manualPlan: work.manualPlan.slice(0, count) } : { ...work, n: count };
}

/**
 * Replaces the rows from `index` with a schedule rebuilt on `balanceMinor`
 * (0 removes them). `keepInstallment` holds the installment and lets the term
 * float (French only); otherwise the remaining number of periods is kept.
 */
function rebuildTail(state, index, balanceMinor, keepInstallment) {
  const head = state.rows.slice(0, index);
  const fromPeriod = index + 1 - state.offset;
  const fixed = keepInstallment ? levelInstallment(state, index) : undefined;
  let { work } = state;
  if (work.grace && fromPeriod > work.grace.periods) {
    const { grace, ...rest } = work;
    work = rest;
  }
  let tail = [];
  if (balanceMinor > 0) {
    tail = buildSchedule(work, { fromPeriod, balanceMinor, ...(fixed === undefined ? {} : { installmentMinor: fixed }) });
    // A manual plan can outlast the balance: rows with nothing left to amortize disappear.
    if (work.system === 'manual') tail = tail.filter((row) => row.openingMinor > 0);
  }
  state.rows = head.concat(tail.map((row) => newRow({ ...row, period: row.period + state.offset })));
  state.work = resized(work, state.rows.length - state.offset);
}

/** extra_payment: first what is already due, then the rest as principal under the chosen strategy. */
export function applyExtra(state, event) {
  const { amountMinor, effectiveOn, id, payload } = event;
  if (state.work.system === 'none') return { allocation: payBalanceOnly(state, amountMinor) };
  const order = state.work.allocationOrder;
  if (payload.strategy === 'advance_installments') return { allocation: payRows(state.rows, amountMinor, order, id) };
  const allocation = payRows(state.rows, amountMinor, order, id, effectiveOn);
  const index = allocation.surplus > 0 ? tailStart(state.rows, effectiveOn) : -1;
  if (index < 0) return { allocation };
  const opening = state.rows[index].openingMinor;
  const prepaid = Math.min(allocation.surplus, opening);
  rebuildTail(state, index, opening - prepaid, payload.strategy === 'reduce_term');
  return {
    allocation: { ...allocation, principal: allocation.principal + prepaid, surplus: allocation.surplus - prepaid },
    extraPrincipalMinor: prepaid,
  };
}

/** rate_change: the new rate applies to the installments after the effective date. */
export function applyRateChange(state, event) {
  const { rate, mode } = event.payload;
  state.work = { ...state.work, rate };
  const index = tailStart(state.rows, event.effectiveOn);
  if (index >= 0) rebuildTail(state, index, state.rows[index].openingMinor, mode === 'keep_installment');
  return {};
}

/** charge_change: the new charge set replaces the old one on the installments after the effective date. */
export function applyChargeChange(state, event) {
  state.work = { ...state.work, charges: event.payload.charges };
  const index = tailStart(state.rows, event.effectiveOn);
  if (index < 0) return {};
  const local = state.rows.slice(index).map((row) => ({ ...row, period: row.period - state.offset }));
  const recharged = addCharges(local, state.work).map((row) => ({ ...row, period: row.period + state.offset }));
  state.rows = state.rows.slice(0, index).concat(recharged);
  return {};
}

/**
 * restructure: new terms from the effective date. Installments due on or before
 * it stay as history (what they still owed is refinanced), later ones are
 * replaced by a schedule on the new terms over the balance carried forward
 * (principal plus the unpaid interest and charges of the refinanced rows).
 */
export function applyRestructure(state, event) {
  const date = event.effectiveOn;
  const terms = event.payload.terms;
  let carried = balanceAt(state.rows, state.noneBalance, date);
  const kept = state.rows.filter((row) => compareIso(row.dueOn, date) <= 0);
  for (const row of kept) {
    const outstanding = rowOutstanding(row);
    if (outstanding === 0) continue;
    carried += outstanding - rowDue(row).principal; // the unpaid principal is in the balance already
    row.refinancedMinor = outstanding;
    row.settled = true;
  }
  state.rows = kept;
  state.offset = kept.length;
  state.termsVersion += 1;
  state.work = terms;
  state.noneBalance = 0;
  if (terms.system === 'none') state.noneBalance = carried;
  else if (carried > 0) {
    const tail = buildSchedule(terms, { balanceMinor: carried });
    state.rows = kept.concat(tail.map((row) => newRow({ ...row, period: row.period + kept.length })));
  }
  return {};
}

/**
 * adjustment: the statement balance is the truth. The difference to the
 * computed balance is recorded as drift and absorbed by rebuilding the
 * installments after the date (same number of periods).
 */
export function applyAdjustment(state, event) {
  const stated = event.payload.balanceMinor;
  if (stated === undefined) return {};
  const date = event.effectiveOn;
  const driftMinor = stated - balanceAt(state.rows, state.noneBalance, date);
  if (driftMinor === 0) return { driftMinor };
  if (state.work.system === 'none') {
    state.noneBalance = stated;
    return { driftMinor, absorbed: true };
  }
  const index = tailStart(state.rows, date);
  if (index >= 0) rebuildTail(state, index, Math.max(state.rows[index].openingMinor + driftMinor, 0), false);
  return { driftMinor, absorbed: index >= 0 };
}
