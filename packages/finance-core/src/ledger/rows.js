import { compareIso } from '../calendar.js';
import { roundUnit } from '../money.js';
import { BUCKETS, allocate, allocateSplit, emptyBuckets } from './allocate.js';

// Working rows of a projection: a schedule row plus what has been paid per
// bucket. They are private to one `project()` call and mutated in place.
// Every row can be paid in full: `totalDueMinor` is always
// charges + taxes + interest due + principal due (installment = interest due +
// principal due), so a capitalizing row (negative principal) only owes charges.
// Mora is not scheduled: `accrueLate` adds to the exact accumulator `row.late.exact`
// and the row exposes it rounded once (`lateMinor`), on top of `totalDueMinor`.

/** Wraps a schedule row for payment tracking. */
export const newRow = (scheduleRow) => ({
  ...scheduleRow,
  paid: emptyBuckets(),
  paidByEventIds: [],
  settled: false,
  refinancedMinor: 0,
  late: { exact: 0, days: 0, unit: 1 },
});

export const paidTotal = (row) => BUCKETS.reduce((sum, key) => sum + row.paid[key], 0);

/** Mora accrued so far, rounded once to the rounding unit (the accumulator itself stays exact). */
export const lateMinor = (row) => roundUnit(row.late.exact, row.late.unit);

/** Outstanding amount per bucket; late interest is the accrued mora not yet paid. */
export function rowDue(row) {
  const zero = emptyBuckets();
  if (row.settled) return zero;
  const principalDue = Math.max(row.principalMinor, 0);
  const interestDue = Math.max(row.installmentMinor - principalDue, 0);
  return {
    ...zero,
    charges: row.chargesMinor - row.paid.charges,
    taxes: row.taxesMinor - row.paid.taxes,
    lateInterest: lateMinor(row) - row.paid.lateInterest,
    interest: interestDue - row.paid.interest,
    principal: principalDue - row.paid.principal,
  };
}

export const rowOutstanding = (row) => (row.settled ? 0 : row.totalDueMinor + lateMinor(row) - paidTotal(row));

const touch = (row, eventId) => {
  if (!row.paidByEventIds.includes(eventId)) row.paidByEventIds.push(eventId);
};

/**
 * Pays the oldest open rows first, bucket by bucket, spilling over to the next
 * row once one is covered. With `throughDate` only rows due on or before that
 * date are considered.
 * @returns {object} The allocation across all rows; `surplus` is what no row could take.
 */
export function payRows(rows, amountMinor, order, eventId, throughDate) {
  const result = { ...emptyBuckets(), surplus: amountMinor };
  for (const row of rows) {
    if (result.surplus === 0) break;
    if (throughDate !== undefined && compareIso(row.dueOn, throughDate) > 0) break;
    const part = allocate(result.surplus, rowDue(row), order);
    if (part.surplus === result.surplus) continue;
    for (const key of BUCKETS) {
      row.paid[key] += part[key];
      result[key] += part[key];
    }
    result.surplus = part.surplus;
    touch(row, eventId);
  }
  return result;
}

/**
 * Applies a bank-stated split to the oldest rows bucket by bucket. Cost the
 * bank charged beyond the schedule still counts as paid; principal that fits
 * nowhere becomes surplus.
 */
export function paySplit(rows, split, eventId) {
  let left = { ...emptyBuckets(), ...split };
  const result = emptyBuckets();
  for (const row of rows) {
    const { taken, left: rest } = allocateSplit(left, rowDue(row));
    left = rest;
    if (!BUCKETS.some((key) => taken[key] > 0)) continue;
    for (const key of BUCKETS) {
      row.paid[key] += taken[key];
      result[key] += taken[key];
    }
    touch(row, eventId);
  }
  for (const key of BUCKETS) if (key !== 'principal') result[key] += left[key];
  return { ...result, surplus: left.principal };
}

/**
 * Pays a balance-only debt (system none): principal reduces the balance, cost
 * stated by the bank counts as paid, and whatever exceeds the balance is surplus.
 * @param {{ noneBalance: number }} state Mutated.
 */
export function payBalanceOnly(state, amountMinor, split) {
  const stated = { ...emptyBuckets(), ...(split ?? { principal: amountMinor }) };
  const principal = Math.min(stated.principal, state.noneBalance);
  state.noneBalance -= principal;
  const result = { ...stated, principal };
  return { ...result, surplus: amountMinor - BUCKETS.reduce((sum, key) => sum + result[key], 0) };
}

/**
 * Principal still owed on `date`: the unpaid principal of the rows, minus the
 * interest of capitalizing rows (negative principal) that has not accrued yet.
 */
export function balanceAt(rows, noneBalance, date) {
  let balance = noneBalance;
  for (const row of rows) {
    if (row.settled) continue;
    if (row.principalMinor > 0) balance += row.principalMinor - row.paid.principal;
    else if (compareIso(row.dueOn, date) > 0) balance += row.principalMinor;
  }
  return Math.max(balance, 0);
}

/** Plan rows for the projection output, each with its status at `asOf`. */
export function decorate(rows, asOf) {
  let dueTaken = false;
  return rows.map((row) => {
    const { paid, settled, refinancedMinor, late, ...schedule } = row;
    const paidMinor = paidTotal(row);
    const outstandingMinor = rowOutstanding(row);
    const overdue = compareIso(row.dueOn, asOf) < 0;
    let status = 'future';
    if (row.totalDueMinor === 0) status = overdue || row.dueOn === asOf ? 'paid' : 'future';
    else if (outstandingMinor === 0) status = 'paid';
    else if (overdue) status = 'pastDue';
    else if (paidMinor > 0) status = 'partial';
    else if (!dueTaken) {
      status = 'due';
      dueTaken = true;
    }
    const extra = refinancedMinor > 0 ? { refinancedMinor } : {};
    // Mora so far; the base is the principal still unpaid, shown only once the row has accrued something.
    const lateFields = { lateMinor: lateMinor(row), lateDays: late.days, lateBaseMinor: late.days > 0 ? rowDue(row).principal : 0 };
    return { ...schedule, paidByEventIds: row.paidByEventIds.slice(), status, paidMinor, outstandingMinor, ...extra, ...lateFields };
  });
}
