import { addMonthsClamped, compareIso, daysBetween } from '../calendar.js';
import { evaluateCharges } from '../charges.js';
import { ValidationError } from '../errors.js';
import { BUCKETS, allocate, emptyBuckets } from '../ledger/allocate.js';
import { DEFAULT_LEGAL } from '../legal.js';
import { roundUnit } from '../money.js';
import { periodicRate } from '../rates.js';
import { buildSchedule } from '../schedule/index.js';
import { accrueCardLate, lateView, markDue, newCardLate, newLateItem, pendingLate, refreshLate, settleLate } from './late.js';

// Credit card projector (S7). A card is a statement-driven parent debt (AD of
// the credit-card-debt spec): the balance moves only through payments, `charge`
// events (purchases, installment purchases, cash advances), `rate_change` and
// the statements themselves (fee and interest are billed at each cut-off date).
//
// Moments are replayed in date order. On one day the order is: events,
// the due-date mark of that day's cycle, the statement close.
//   - Interest on the revolving balance is billed at the NEXT statement on what
//     was still unpaid on the due date, so a statement paid in full by its due
//     date never accrues interest. (First cycle approximation: the opening
//     balance counts as already billed; there is no day count.)
//   - Installment purchases (n >= 2) follow their own French plan fixed at
//     purchase; a purchase in one installment is an ordinary purchase.
//   - Cash advances accrue from their date, prorated in their first cycle.
//   - Past due is measured against the minimum payment of each closed cycle:
//     payments cover the oldest unmet minimum first, so a late payment still
//     reduces the shortfall (interest is decided by the balance on the due date).
//   - An `adjustment` is the statement's truth: it is applied after that day's
//     close, resets tranche balances and absorbs the rest in the revolving balance.
//   - Mora (F3, `./late.js`) accrues on the capital of the minimum left unpaid after the due date, until the
//     next close, where it is billed as a line of that statement. A billed mora line accrues nothing more.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_CYCLES = 1200;
const REVOLVING = 'revolving';
const invalidCard = (message) => new ValidationError('invalid_card', message);

/**
 * Statement and due date of the cycle whose statement falls in `month`. The
 * due date is in the same month when `dueDay` is later than `statementDay`, and
 * in the next month otherwise. Days beyond a month's end clamp to its last day.
 * @param {number} statementDay 1..31
 * @param {number} dueDay 1..31
 * @param {string} month `YYYY-MM`
 * @returns {{ statementOn: string, dueOn: string }}
 */
export function cycleDates(statementDay, dueDay, month) {
  for (const [label, day] of [['statementDay', statementDay], ['dueDay', dueDay]]) {
    if (!Number.isInteger(day) || day < 1 || day > 31) throw invalidCard(`${label} must be a whole day 1..31, got ${String(day)}`);
  }
  if (typeof month !== 'string' || !MONTH.test(month)) throw new ValidationError('invalid_date', `month must be YYYY-MM, got ${String(month)}`);
  const first = `${month}-01`;
  return { statementOn: addMonthsClamped(first, 0, statementDay), dueOn: addMonthsClamped(first, dueDay > statementDay ? 0 : 1, dueDay) };
}

/**
 * Minimum payment of a statement. Rules: `interest_fees_plus_pct` (interest,
 * fees and installments plus `pct`% of the revolving and advance balance),
 * `installments_due` (interest, fees and installments only) and `pct_balance`
 * (`pct`% of the whole statement). The floor applies, but never more than the
 * whole statement is asked.
 * @param {{ rule?: string, pct?: number, floorMinor?: number }} minPayment
 * @param {{ contractualMinor: number, revolvingMinor: number, payInFullMinor: number, unit?: number }} cycle
 * @returns {number}
 */
export function minimumPayment(minPayment, cycle) {
  const { rule = 'interest_fees_plus_pct', pct = 5, floorMinor = 0 } = minPayment ?? {};
  const { contractualMinor, revolvingMinor, payInFullMinor, unit = 1 } = cycle;
  let amount = contractualMinor + (revolvingMinor * pct) / 100;
  if (rule === 'installments_due') amount = contractualMinor;
  else if (rule === 'pct_balance') amount = (payInFullMinor * pct) / 100;
  return Math.min(payInFullMinor, Math.max(roundUnit(amount, unit), floorMinor));
}

/** Closed cycles up to `asOf` (statements on or after the opening date) plus the next one. */
function cyclesThrough(card, openedOn, asOf) {
  const cycles = [];
  let month = openedOn.slice(0, 7);
  while (cycles.length < MAX_CYCLES) {
    const dates = cycleDates(card.statementDay, card.dueDay, month);
    month = addMonthsClamped(`${month}-01`, 1).slice(0, 7);
    if (compareIso(dates.statementOn, openedOn) < 0) continue;
    if (compareIso(dates.statementOn, asOf) > 0) return { cycles, next: dates };
    cycles.push({ period: cycles.length + 1, ...dates });
  }
  return { cycles, next: null };
}

const monthly = (rate) => periodicRate(rate, 'monthly');
const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
const ofType = (state, type) => state.tranches.filter((tranche) => tranche.type === type);

const balanceOf = (state) =>
  state.billed + state.pending + sum(state.tranches, (t) => t.balanceMinor) + state.accrued.charges + state.accrued.taxes + state.accrued.interest + state.accrued.lateInterest;

/** What a payment on the statement settles: everything billed and not yet paid. */
const payInFullOf = (state) =>
  state.accrued.charges + state.accrued.taxes + state.accrued.lateInterest + state.accrued.interest + sum(ofType(state, 'deferred'), (t) => t.dueMinor) + sum(ofType(state, 'advance'), (t) => t.balanceMinor) + state.billed;

function frenchRows(state, { openedOn, principalMinor, n, rate }) {
  return buildSchedule({
    kind: 'other',
    principalMinor,
    openedOn,
    rate,
    system: 'french',
    periodicity: 'monthly',
    n,
    firstDueOn: addMonthsClamped(openedOn, 1),
    roundingUnit: state.unit,
  });
}

function openDeferred(state, spec) {
  const { id, label, openedOn, principalMinor, n, rate } = spec;
  state.tranches.push({ id, type: 'deferred', label, openedOn, principalMinor, balanceMinor: principalMinor, rate, n, rows: frenchRows(state, spec), next: 0, dueMinor: 0 });
}

function applyCharge(state, event) {
  const { trancheType, label, n = 1, rate } = event.payload;
  const id = `t${event.id}`;
  const spec = { id, label, openedOn: event.effectiveOn, principalMinor: event.amountMinor };
  if (trancheType === 'advance') {
    state.tranches.push({ ...spec, type: 'advance', balanceMinor: event.amountMinor, rate: rate ?? state.card.advanceRate ?? state.rate });
  } else if (trancheType === 'deferred' && n >= 2) {
    openDeferred(state, { ...spec, n, rate: rate ?? state.rate });
  } else {
    state.pending += event.amountMinor;
    return {};
  }
  return { trancheId: id };
}

function applyPayment(state, event) {
  const deferred = ofType(state, 'deferred');
  const advances = ofType(state, 'advance');
  const due = {
    charges: state.accrued.charges,
    taxes: state.accrued.taxes,
    lateInterest: state.accrued.lateInterest,
    interest: state.accrued.interest,
    principal: sum(deferred, (t) => t.dueMinor) + sum(advances, (t) => t.balanceMinor) + state.billed + state.pending,
  };
  const allocation = allocate(event.amountMinor, due, state.order);
  for (const key of ['charges', 'taxes', 'lateInterest', 'interest']) state.accrued[key] -= allocation[key];
  // Principal goes to the installments due, then cash advances, then the revolving balance.
  let left = allocation.principal;
  for (const tranche of deferred) {
    const take = Math.min(left, tranche.dueMinor);
    tranche.dueMinor -= take;
    tranche.balanceMinor -= take;
    left -= take;
  }
  for (const tranche of advances) {
    const take = Math.min(left, tranche.balanceMinor);
    tranche.balanceMinor -= take;
    left -= take;
  }
  const billed = Math.min(left, state.billed);
  state.billed -= billed;
  state.pending -= left - billed;
  let rest = event.amountMinor;
  for (const cycle of state.cycles) {
    const take = Math.min(rest, Math.max(cycle.minimum - cycle.covered, 0));
    if (take === 0) continue;
    cycle.covered += take;
    cycle.eventIds.push(event.id);
    rest -= take;
  }
  refreshLate(state);
  return { allocation };
}

function setTranche(state, id, value) {
  if (id === REVOLVING) {
    state.billed = value;
    state.pending = 0;
    return;
  }
  const tranche = state.tranches.find((item) => item.id === id);
  if (!tranche) return;
  tranche.balanceMinor = value;
  if (tranche.type !== 'deferred') return;
  // Rebuild the installments not billed yet over the same number of statements.
  tranche.dueMinor = Math.min(tranche.dueMinor, value);
  const left = tranche.rows.length - tranche.next;
  const unbilled = value - tranche.dueMinor;
  tranche.rows = left > 0 && unbilled > 0 ? frenchRows(state, { ...tranche, principalMinor: unbilled, n: left }) : [];
  tranche.next = 0;
}

function applyAdjustment(state, event) {
  const { balanceMinor, trancheBalances = {}, minimumDueMinor, lateInterestMinor } = event.payload;
  const before = balanceOf(state);
  const latest = state.cycles[state.cycles.length - 1];
  // The stated mora replaces the billed line of the latest statement; the difference stays on that line, never in the revolving balance.
  if (lateInterestMinor !== undefined && latest) {
    const next = Math.max(state.accrued.lateInterest + lateInterestMinor - latest.lateInterest, 0);
    const diff = next - state.accrued.lateInterest;
    state.accrued.lateInterest = next;
    latest.lateInterest += diff;
    latest.total += diff;
    latest.payInFull += diff;
    latest.closing += diff;
  }
  for (const id of Object.keys(trancheBalances)) setTranche(state, id, trancheBalances[id]);
  if (balanceMinor !== undefined) state.billed = Math.max(state.billed + balanceMinor - balanceOf(state), 0);
  if (minimumDueMinor !== undefined && latest) latest.minimum = minimumDueMinor;
  refreshLate(state);
  return { driftMinor: balanceOf(state) - before, absorbed: balanceMinor === undefined || balanceOf(state) === balanceMinor };
}

const HANDLERS = {
  adjustment: applyAdjustment,
  payment: applyPayment,
  extra_payment: applyPayment,
  charge: applyCharge,
  rate_change: (state, event) => {
    state.rate = event.payload.rate;
    state.late.work = { ...state.late.work, rate: event.payload.rate };
    return {};
  },
  late_policy: (state, event) => {
    state.late.work = { ...state.late.work, late: event.payload.late };
    return {};
  },
  charge_change: (state, event) => {
    state.charges = event.payload.charges;
    return {};
  },
};

function closeCycle(state, cycle) {
  const { unit } = state;
  const previous = addMonthsClamped(cycle.statementOn, -1, state.card.statementDay);
  // The mora of the statements ending now is billed here; the capital it ran on paid no revolving interest those days.
  const late = settleLate(state, daysBetween(previous, cycle.statementOn));
  const base = state.interestBase ?? state.billed;
  const lines = { interest: roundUnit(Math.max(base - Math.min(late.excludedBase, base), 0) * monthly(state.rate), unit), deferred: 0, late: late.billedMinor };
  // What the interest above ran on, for the explanations: the part of the previous statement paid by its due date accrued
  // nothing, and the average unmet capital of the mora days is taken out of the base (whole units, so the fields add up).
  const lateExcludedBase = Math.round(Math.min(late.excludedBase, base));
  const bases = { revolving: Math.max(base - lateExcludedBase, 0), excluded: Math.max(state.closedBilled - base, 0), lateExcluded: lateExcludedBase };
  for (const tranche of state.tranches) {
    if (tranche.type === 'advance' && tranche.balanceMinor > 0) {
      const share = compareIso(tranche.openedOn, previous) > 0 ? daysBetween(tranche.openedOn, cycle.statementOn) / daysBetween(previous, cycle.statementOn) : 1;
      lines.interest += roundUnit(tranche.balanceMinor * monthly(tranche.rate) * share, unit);
    } else if (tranche.type === 'deferred' && tranche.next < tranche.rows.length && compareIso(tranche.openedOn, cycle.statementOn) <= 0) {
      const installment = tranche.rows[tranche.next];
      tranche.next += 1;
      tranche.dueMinor += installment.principalMinor;
      lines.interest += installment.interestMinor;
      lines.deferred += installment.principalMinor;
    }
  }
  const fees = evaluateCharges(state.charges, {
    period: cycle.period,
    openingMinor: balanceOf(state),
    installmentMinor: lines.deferred + lines.interest,
    originalMinor: state.principalMinor,
    periodsPerYear: 12,
    unit,
  });
  state.accrued.charges += fees.chargesMinor;
  state.accrued.taxes += fees.taxesMinor;
  state.accrued.interest += lines.interest;
  state.accrued.lateInterest += lines.late;
  state.interestBase = null;
  state.billed += state.pending;
  state.pending = 0;
  state.closedBilled = state.billed;
  const total = lines.interest + lines.deferred + fees.chargesMinor + fees.taxesMinor + lines.late;
  const payInFull = payInFullOf(state);
  const minimum = minimumPayment(state.card.minPayment, {
    contractualMinor: total,
    revolvingMinor: state.billed + sum(ofType(state, 'advance'), (t) => t.balanceMinor),
    payInFullMinor: payInFull,
    unit,
  });
  state.cycles.push({
    ...cycle,
    interest: lines.interest,
    bases,
    deferred: lines.deferred,
    charges: fees.chargesMinor,
    taxes: fees.taxesMinor,
    lateInterest: lines.late,
    late: newLateItem(unit, cycle.dueOn),
    chargeLines: fees.lines,
    total,
    payInFull,
    minimum,
    covered: 0,
    eventIds: [],
    closing: balanceOf(state),
  });
}

function trancheView(state) {
  const revolving = { id: REVOLVING, type: REVOLVING, label: 'Revolving balance', balanceMinor: state.billed + state.pending, rate: state.rate };
  const others = state.tranches.map(({ rows, next, ...tranche }) => (tranche.type === 'deferred' ? { ...tranche, installmentsLeft: rows.length - next } : tranche));
  return [revolving, ...others];
}

function totalsOf(applied, accrued, pendingLateMinor) {
  const paid = emptyBuckets();
  for (const entry of applied) if (entry.allocation) for (const key of BUCKETS) paid[key] += entry.allocation[key];
  return {
    interestPaid: paid.interest,
    chargesPaid: paid.charges,
    taxesPaid: paid.taxes,
    lateInterestPaid: paid.lateInterest,
    principalPaid: paid.principal,
    remainingInterest: accrued.interest,
    remainingCharges: accrued.charges,
    remainingTaxes: accrued.taxes,
    remainingLateInterest: accrued.lateInterest + pendingLateMinor,
  };
}

/**
 * Projector for `kind: 'card'` debts; `project()` calls it through the registry.
 * Returns the usual projection plus `tranches` and a `card` summary; `plan` holds
 * one row per closed statement.
 * @param {{ debt: object, terms: object, events: object[], asOf: string }} context Events are active and sorted.
 * @returns {object} Projection
 */
export function projectCard({ debt, terms, events, asOf, legal = DEFAULT_LEGAL }) {
  const state = {
    card: terms.card,
    unit: terms.roundingUnit,
    order: terms.allocationOrder,
    rate: terms.rate,
    charges: terms.charges,
    principalMinor: terms.principalMinor,
    billed: terms.principalMinor,
    closedBilled: terms.principalMinor, // the revolving balance at the last close; the opening balance counts as already billed
    pending: 0,
    interestBase: null,
    accrued: { charges: 0, taxes: 0, interest: 0, lateInterest: 0 },
    tranches: [],
    cycles: [],
    legal,
    late: newCardLate(terms),
  };
  for (const item of terms.card.deferred) openDeferred(state, { openedOn: terms.openedOn, ...item });
  const { cycles, next } = cyclesThrough(terms.card, terms.openedOn, asOf);
  const moments = events.map((event) => ({ at: event.effectiveOn, rank: event.kind === 'adjustment' ? 3 : 0, event }));
  for (const cycle of cycles) {
    moments.push({ at: cycle.statementOn, rank: 2, close: cycle });
    if (compareIso(cycle.dueOn, asOf) <= 0) moments.push({ at: cycle.dueOn, rank: 1, due: cycle });
  }
  moments.sort((a, b) => compareIso(a.at, b.at) || a.rank - b.rank);

  const applied = [];
  const notices = [];
  for (const moment of moments) {
    accrueCardLate(state, moment.at); // days up to the moment are accrued under the policy in force before it
    if (moment.close) {
      closeCycle(state, moment.close);
      // A due date clamped onto the statement day is marked right after the close.
      if (moment.close.dueOn === moment.close.statementOn) markDue(state, state.cycles[state.cycles.length - 1]);
    } else if (moment.due) {
      state.interestBase = state.billed;
      if (moment.due.dueOn !== moment.due.statementOn) markDue(state, state.cycles.find((closed) => closed.period === moment.due.period));
    } else {
      const { event } = moment;
      const { allocation = null, ...extra } = HANDLERS[event.kind]?.(state, event) ?? {};
      const costMinor = allocation ? allocation.charges + allocation.taxes + allocation.lateInterest + allocation.interest : 0;
      applied.push({ eventId: event.id, kind: event.kind, effectiveOn: event.effectiveOn, allocation, costMinor, ...extra });
      if (extra.driftMinor) notices.push({ code: 'drift', eventId: event.id, amountMinor: extra.driftMinor, absorbed: extra.absorbed });
      if (event.kind === 'restructure') notices.push({ code: 'card_restructure_ignored', eventId: event.id });
    }
  }
  accrueCardLate(state, asOf);

  let dueTaken = false;
  const plan = state.cycles.map((cycle) => {
    const outstandingMinor = Math.max(cycle.minimum - cycle.covered, 0);
    let status = 'future';
    if (outstandingMinor === 0) status = 'paid';
    else if (compareIso(cycle.dueOn, asOf) < 0) status = 'pastDue';
    else if (cycle.covered > 0) status = 'partial';
    else if (!dueTaken) {
      status = 'due';
      dueTaken = true;
    }
    return {
      period: cycle.period,
      statementOn: cycle.statementOn,
      dueOn: cycle.dueOn,
      interestMinor: cycle.interest,
      revolvingBaseMinor: cycle.bases.revolving,
      excludedBaseMinor: cycle.bases.excluded,
      lateExcludedBaseMinor: cycle.bases.lateExcluded,
      principalMinor: cycle.deferred,
      installmentMinor: cycle.interest + cycle.deferred,
      charges: cycle.chargeLines,
      chargesMinor: cycle.charges,
      taxesMinor: cycle.taxes,
      closingMinor: cycle.closing,
      statementTotalMinor: cycle.total,
      payInFullMinor: cycle.payInFull,
      minimumMinor: cycle.minimum,
      totalDueMinor: cycle.minimum,
      paidMinor: cycle.covered,
      outstandingMinor,
      paidByEventIds: cycle.eventIds.slice(),
      ...lateView(cycle),
      status,
    };
  });
  const pastDueMinor = sum(plan, (entry) => (entry.status === 'pastDue' ? entry.outstandingMinor : 0));
  const nextDue = plan.find((entry) => entry.status === 'pastDue' || entry.status === 'partial' || entry.status === 'due') ?? null;
  const tranches = trancheView(state);
  const totals = totalsOf(applied, state.accrued, pendingLate(state));
  return {
    asOf,
    termsVersion: debt.termsVersion ?? 1,
    terms,
    balanceMinor: balanceOf(state),
    pastDueMinor,
    nextDue,
    remainingPeriods: tranches.reduce((most, tranche) => Math.max(most, tranche.installmentsLeft ?? 0), 0),
    plan,
    applied,
    tranches,
    lateInterestMinor: totals.remainingLateInterest,
    totals,
    notices: [...applied.filter((entry) => entry.allocation?.surplus > 0).map((entry) => ({ code: 'surplus', eventId: entry.eventId, amountMinor: entry.allocation.surplus })), ...notices, ...state.late.lateNotices],
    card: {
      statementDay: terms.card.statementDay,
      dueDay: terms.card.dueDay,
      nextStatementOn: next?.statementOn ?? null,
      nextDueOn: next?.dueOn ?? null,
      payInFullMinor: payInFullOf(state),
      minimumDueMinor: nextDue?.outstandingMinor ?? 0,
      minimumPastDue: pastDueMinor > 0,
    },
  };
}
