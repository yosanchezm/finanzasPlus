import { addDays, compareIso, daysBetween } from '../calendar.js';
import { accrueLate } from '../late/accrue.js';
import { normalizeLate } from '../late/policy.js';
import { emptyBuckets } from '../ledger/allocate.js';
import { lateMinor } from '../ledger/rows.js';

// Card mora (F3). Each closed statement owns one mora item, a pseudo schedule row the loan engine
// (`accrueLate`) already knows how to accrue: the exact accumulator, the single rounding, the cap segments
// and the notices all come from `late/accrue.js`. What is card specific lives here:
//   - the base is the unmet CAPITAL of the minimum payment (the shortfall less interest, fees, taxes and the
//     mora line of that statement, because payments settle those first), counted from the day after the due
//     date plus the grace days;
//   - the item stops at the next statement close, where its mora is billed as a line of that statement;
//   - the days the mora runs replace the revolving interest on the same capital (`baseDays` feeds that).
// `state.late` is the accrual state `accrueLate` expects: `{ work, rows, lateClock, lateNotices }`.

/** The accrual state of a card projection. `work` carries the terms in force (`rate`, `late`, `modality`...). */
export function newCardLate(terms) {
  return { work: { ...terms }, rows: [], lateClock: terms.openedOn, lateNotices: [] };
}

/** The mora item of a statement; its pseudo row is active from the due date mark until the next close. */
export function newLateItem(unit, dueOn) {
  const row = {
    dueOn,
    principalMinor: 0,
    installmentMinor: 0,
    chargesMinor: 0,
    taxesMinor: 0,
    totalDueMinor: 0,
    paid: emptyBuckets(),
    settled: false,
    late: { exact: 0, days: 0, unit },
  };
  return { row, marked: false, stopped: false, baseMinor: 0, baseDays: 0, billedMinor: 0 };
}

/** The capital of the minimum still unmet: payments settle interest, fees, taxes and mora before capital. */
function unmetCapital(cycle) {
  const capital = Math.max(cycle.minimum - (cycle.interest + cycle.charges + cycle.taxes + cycle.lateInterest), 0);
  return Math.min(Math.max(cycle.minimum - cycle.covered, 0), capital);
}

/** Re-reads the unmet capital of every running item; call after anything that moves `covered` or `minimum`. */
export function refreshLate(state) {
  for (const cycle of state.cycles) {
    const item = cycle.late;
    if (!item.marked || item.stopped) continue;
    item.baseMinor = unmetCapital(cycle);
    item.row.principalMinor = item.baseMinor;
  }
}

/** The due date of a statement has come: its unmet capital starts to run (after the grace days). */
export function markDue(state, cycle) {
  const item = cycle.late;
  if (item.marked) return;
  item.marked = true;
  state.late.rows.push(item.row);
  refreshLate(state);
}

/**
 * Accrues mora up to `to` (included). The base-days of each running item are kept alongside, in the same window,
 * to take the unmet capital out of the revolving interest of the cycle.
 * @param {object} state Card projection state.
 * @param {string} to ISO date.
 */
export function accrueCardLate(state, to) {
  const { late, legal } = state;
  if (compareIso(to, late.lateClock) <= 0) return;
  const { mode, graceDays } = normalizeLate(late.work.late);
  if (mode !== 'none') {
    for (const cycle of state.cycles) {
      const item = cycle.late;
      if (!item.marked || item.stopped || item.baseMinor <= 0) continue;
      const startAfter = addDays(cycle.dueOn, graceDays);
      const begin = compareIso(startAfter, late.lateClock) > 0 ? startAfter : late.lateClock;
      if (compareIso(begin, to) < 0) item.baseDays += item.baseMinor * daysBetween(begin, to);
    }
  }
  accrueLate(late, to, legal);
}

/**
 * The statement closing on `statementOn` ends every running item: each is billed at its rounded accrued value.
 * Returns the mora billed on this statement and the average capital (over the `cycleDays` of the cycle) whose
 * revolving interest the mora replaced.
 * @param {object} state
 * @param {number} cycleDays Days between the previous close and this one.
 * @returns {{ billedMinor: number, excludedBase: number }}
 */
export function settleLate(state, cycleDays) {
  let billedMinor = 0;
  let baseDays = 0;
  for (const cycle of state.cycles) {
    const item = cycle.late;
    if (item.stopped) continue;
    item.stopped = true;
    item.billedMinor = item.marked ? lateMinor(item.row) : 0;
    billedMinor += item.billedMinor;
    baseDays += item.baseDays;
    state.late.rows = state.late.rows.filter((row) => row !== item.row);
  }
  return { billedMinor, excludedBase: cycleDays > 0 ? baseDays / cycleDays : 0 };
}

/** Mora accrued on the running items and not billed yet (rounded per item, like the bill will be). */
export function pendingLate(state) {
  let total = 0;
  for (const cycle of state.cycles) if (!cycle.late.stopped && cycle.late.marked) total += lateMinor(cycle.late.row);
  return total;
}

/** What the plan row of a statement shows about its mora item. */
export function lateView(cycle) {
  const item = cycle.late;
  return {
    lateInterestMinor: cycle.lateInterest,
    lateMinor: item.stopped ? item.billedMinor : lateMinor(item.row),
    lateDays: item.row.late.days,
    lateBaseMinor: item.baseMinor,
  };
}
