import { project } from '../../ledger/project.js';
import { rateInForce } from '../../ledger/rateInForce.js';
import { roundUnit } from '../../money.js';
import { convertRate, periodicRate, toEffectiveAnnual } from '../../rates.js';
import { dateText, pesosText, percentText, round4 } from '../format.js';

// Facts of the card topics (spec: Card topics). `card_statement` shows the last statement, its minimum payment and the
// minimum rule. `card_interest_drop` shows, from the core, the revolving base the interest ran on and the excluded base
// (the part paid by the due date), why a lower interest came out, and a what-if of paying only the minimum. Every figure
// is read from the card projection (`revolvingBaseMinor`, `excludedBaseMinor` and `lateExcludedBaseMinor` of the plan
// rows); the what-if is two projections of the same card. Pure and read-only.

const PAYMENT_KINDS = ['payment', 'extra_payment'];
const WHAT_IF_CREATED_AT = '9999-12-31T00:00:00.000Z'; // sorts after any recorded event of the same day

const lastStatement = (projection) => projection.plan[projection.plan.length - 1] || null;
const unique = (items) => items.filter((item, index) => items.indexOf(item) === index);

/** The minimum rule of the card with the core defaults, as text and figures. */
function ruleFacts(terms) {
  const { rule = 'interest_fees_plus_pct', pct = 5, floorMinor = 0 } = terms.card.minPayment || {};
  const numbers = {};
  const text = { rule };
  if (rule !== 'installments_due') {
    numbers.pct = pct;
    text.pct = percentText(pct);
  }
  if (floorMinor > 0) {
    numbers.floor = floorMinor;
    text.floor = pesosText(floorMinor);
  }
  return { numbers, text };
}

function statementFigures(row) {
  const parts = {
    total: row.statementTotalMinor,
    interest: row.interestMinor,
    installments: row.principalMinor,
    charges: row.chargesMinor + row.taxesMinor,
    late: row.lateInterestMinor,
    payInFull: row.payInFullMinor,
    minimum: row.minimumMinor,
    paid: row.paidMinor,
    outstanding: row.outstandingMinor,
  };
  const text = { statementOn: dateText(row.statementOn), dueOn: dateText(row.dueOn), status: row.status };
  Object.keys(parts).forEach((key) => {
    text[key] = pesosText(parts[key]);
  });
  return { numbers: parts, text };
}

const nextDates = (projection) => ({
  nextStatementOn: projection.card.nextStatementOn ? dateText(projection.card.nextStatementOn) : undefined,
  nextDueOn: projection.card.nextDueOn ? dateText(projection.card.nextDueOn) : undefined,
});

export function cardStatementFacts({ projection }) {
  if (!projection || !projection.card) return { status: 'generic' };
  const rule = ruleFacts(projection.terms);
  const result = { status: 'ok', dataSource: 'debt', numbers: { ...rule.numbers }, text: { ...rule.text }, approximate: [], notices: [] };
  const dates = nextDates(projection);
  Object.keys(dates).forEach((key) => {
    if (dates[key]) result.text[key] = dates[key];
  });
  const row = lastStatement(projection);
  if (!row) {
    result.notices.push({ code: 'no_statement_yet' });
    return result;
  }
  const figures = statementFigures(row);
  Object.assign(result.numbers, figures.numbers);
  Object.assign(result.text, figures.text);
  return result;
}

/**
 * Paying only the minimum on the due date versus paying the statement in full, measured at the next close. Both runs are the
 * card's own projection with its events up to the statement, so a payment recorded after the statement is not mixed in.
 */
function minimumWhatIf({ debt, events, legal, projection }, row) {
  const closeOn = projection.card.nextStatementOn;
  if (!closeOn || !(row.minimumMinor > 0) || !(row.payInFullMinor > 0)) return null;
  const history = events.filter((event) => !(PAYMENT_KINDS.includes(event.kind) && event.effectiveOn > row.statementOn));
  const run = (amountMinor) => {
    const payment = { $id: 'explain-what-if', debtId: debt.$id, kind: 'payment', effectiveOn: row.dueOn, amountMinor, payloadJson: '{}', $createdAt: WHAT_IF_CREATED_AT };
    return project(debt, [...history, payment], closeOn, { legal }).plan.find((item) => item.period === row.period + 1) || null;
  };
  const minimum = run(row.minimumMinor);
  const full = run(row.payInFullMinor);
  if (!minimum || !full) return null;
  const numbers = {
    minPayment: row.minimumMinor,
    fullPayment: row.payInFullMinor,
    minBase: minimum.revolvingBaseMinor,
    minInterest: minimum.interestMinor,
    fullBase: full.revolvingBaseMinor,
    fullInterest: full.interestMinor,
    extra: Math.max(minimum.interestMinor - full.interestMinor, 0),
  };
  const text = { whatIfDueOn: dateText(row.dueOn), whatIfCloseOn: dateText(closeOn) };
  Object.keys(numbers).forEach((key) => {
    text[key] = pesosText(numbers[key]);
  });
  return { numbers, text, approximate: ['minBase', 'minInterest', 'fullBase', 'fullInterest', 'extra'] };
}

export function cardInterestDropFacts(ctx) {
  const { projection } = ctx;
  if (!projection || !projection.card) return { status: 'generic' };
  const rate = rateInForce(projection);
  const monthly = round4(convertRate(rate, 'MV').value);
  const result = {
    status: 'ok',
    dataSource: 'debt',
    numbers: { monthly, ea: round4(toEffectiveAnnual(rate)) },
    text: { monthly: percentText(monthly), ea: percentText(toEffectiveAnnual(rate)) },
    approximate: [],
    notices: [],
  };
  const row = lastStatement(projection);
  if (!row) {
    result.notices.push({ code: 'no_statement_yet' });
    return result;
  }
  const { revolvingBaseMinor: revolving, excludedBaseMinor: excluded, lateExcludedBaseMinor: lateExcluded } = row;
  Object.assign(result.numbers, { interest: row.interestMinor, revolving, excluded, lateExcluded });
  Object.assign(result.text, {
    statementOn: dateText(row.statementOn),
    interest: pesosText(row.interestMinor),
    revolving: pesosText(revolving),
    excluded: pesosText(excluded),
    lateExcluded: pesosText(lateExcluded),
  });
  const previous = projection.plan[projection.plan.length - 2];
  if (previous) {
    result.numbers.previousInterest = previous.interestMinor;
    result.text.previousInterest = pesosText(previous.interestMinor);
    if (previous.interestMinor > row.interestMinor) {
      result.numbers.drop = previous.interestMinor - row.interestMinor;
      result.text.drop = pesosText(result.numbers.drop);
    }
  }
  if (row.period === 1) {
    // The opening balance counts as already billed and there is no day count in the first cycle.
    result.notices.push({ code: 'first_cycle' });
    result.approximate.push('revolving', 'excluded', 'interest');
  }
  if (excluded > 0) result.notices.push({ code: revolving === 0 ? 'paid_in_full' : 'partly_paid' });
  if (lateExcluded > 0) {
    // The unmet capital of the minimum ran mora instead of the revolving interest for the days of the mora.
    const unit = projection.terms.roundingUnit;
    const rateMonthly = periodicRate(rate, 'monthly');
    const effect = Math.max(roundUnit((revolving + lateExcluded) * rateMonthly, unit) - roundUnit(revolving * rateMonthly, unit), 0);
    Object.assign(result.numbers, { withoutLateInterest: row.interestMinor + effect, lateEffect: effect });
    Object.assign(result.text, { withoutLateInterest: pesosText(row.interestMinor + effect), lateEffect: pesosText(effect) });
    result.notices.push({ code: 'mora_replaced' });
    result.approximate.push('lateExcluded', 'revolving', 'withoutLateInterest', 'lateEffect');
  }
  const whatIf = minimumWhatIf(ctx, row);
  if (whatIf) {
    Object.assign(result.numbers, whatIf.numbers);
    Object.assign(result.text, whatIf.text);
    result.approximate.push(...whatIf.approximate);
  }
  result.approximate = unique(result.approximate);
  return result;
}
