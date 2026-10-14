import { addDays, compareIso, daysBetween } from '../calendar.js';
import { rowDue } from '../ledger/rows.js';
import { DEFAULT_LEGAL } from '../legal.js';
import { lateRateOn, modalityOf, normalizeLate } from './policy.js';

// Mora engine (AD9-AD11). `accrueLate(state, to, legal)` runs before every event and once at `asOf`.
// Mora is simple interest on the unpaid principal of each overdue row: per segment and row,
// `exact += base * daily(EA) * days`. The exact float accumulator lives on `row.late` and is rounded
// once when exposed (`lateMinor`), so the rounded total does not depend on where segments are cut.
//
// state = { work, rows, lateClock, lateNotices }
//   work         terms in force (contract rate and policy only change at events)
//   lateClock    last day already accrued; the window of this call is (lateClock, to]
//   lateNotices  deduplicated cap notices raised on days that actually accrued mora
//
// Day clock (AD11): day t accrues when t > dueOn + graceDays and t <= to. A payment dated D has the
// days up to D accrued first, and D itself counts; mora paid on D is the mora of days <= D.

const dayBefore = (iso) => addDays(iso, -1);
const noticeKey = (notice) => `${notice.code}|${notice.modality}|${notice.lastValidTo ?? ''}`;

/** Last day of every constant-cap stretch strictly inside the window (cap periods start/end there). */
function cutPoints(usuryTable, modality, from, to) {
  const cuts = new Set();
  for (const entry of usuryTable) {
    if (entry?.modality !== modality) continue;
    for (const day of [dayBefore(entry.validFrom), entry.validTo]) {
      if (compareIso(day, from) > 0 && compareIso(day, to) < 0) cuts.add(day);
    }
  }
  return Array.from(cuts).sort(compareIso);
}

/** Adds notices to `state.lateNotices`, keeping the first of each (code, modality, lastValidTo). */
export function addLateNotices(state, notices) {
  for (const notice of notices) {
    if (!state.lateNotices.some((known) => noticeKey(known) === noticeKey(notice))) state.lateNotices.push(notice);
  }
}

// Accrues one constant-rate segment (from, to] on every row; true when some row had a base on those days.
function accrueSegment(state, from, to, daily) {
  const { graceDays } = normalizeLate(state.work.late);
  const unit = state.work.roundingUnit ?? 1;
  let accrued = false;
  for (const row of state.rows) {
    const base = rowDue(row).principal;
    if (base <= 0) continue;
    const startAfter = addDays(row.dueOn, graceDays);
    const begin = compareIso(startAfter, from) > 0 ? startAfter : from;
    if (compareIso(begin, to) >= 0) continue;
    const days = daysBetween(begin, to);
    accrued = true;
    row.late.unit = unit;
    if (daily > 0) {
      row.late.exact += base * daily * days;
      row.late.days += days;
    }
  }
  return accrued;
}

/**
 * Accrues mora on every row over (state.lateClock, to] and moves the clock to `to`.
 * A `to` on or before the clock does nothing. Mutates `state`.
 * @param {{ work: object, rows: object[], lateClock: string, lateNotices: object[] }} state
 * @param {string} to ISO date, included.
 * @param {{ usuryTable?: readonly object[] }} [legal] A resolved legal table (default: the code tables).
 */
export function accrueLate(state, to, legal = DEFAULT_LEGAL) {
  const from = state.lateClock;
  if (compareIso(to, from) <= 0) return;
  state.lateClock = to;
  if (normalizeLate(state.work.late).mode === 'none') return;
  const cuts = cutPoints(legal.usuryTable ?? [], modalityOf(state.work), from, to);
  let start = from;
  for (const end of cuts.concat(to)) {
    const { daily, notices } = lateRateOn(state.work, addDays(start, 1), legal);
    if (accrueSegment(state, start, end, daily)) addLateNotices(state, notices);
    start = end;
  }
}
