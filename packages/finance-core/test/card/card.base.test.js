// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { project } from '../../src/ledger/project.js';
import { resolveLegal } from '../../src/legal.js';
import { periodicRate } from '../../src/rates.js';
import { mulberry32 } from '../helpers/prng.js';

// Revolving and excluded base per statement (credit-card-debt spec CC1, additive). Each statement row exposes:
//   revolvingBaseMinor     the balance the revolving interest was computed on (after the mora capital left out),
//   excludedBaseMinor      the part of the previous statement paid by its due date, so it accrued no interest,
//   lateExcludedBaseMinor  the average unmet capital whose days ran mora instead of revolving interest.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));

const NEW_FIELDS = ['revolvingBaseMinor', 'excludedBaseMinor', 'lateExcludedBaseMinor'];
const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const cap = { modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-12-31', capEA: 28.59, source: 'test', verified: true };
const LEGAL = resolveLegal([], { usuryTable: [cap] });
const USURY = { mode: 'usury', graceDays: 0 };
const NO_MORA = { mode: 'none', graceDays: 0 };

const terms = (overrides = {}, card = {}) => ({ ...fixture.terms, ...overrides, card: { ...fixture.terms.card, ...card } });
// A plain revolving card: no installment purchase and no fee, so the whole interest is the revolving one.
const plain = (principalMinor, overrides = {}, card = {}) => terms({ principalMinor, charges: [], ...overrides }, { deferred: [], ...card });
const debt = (t = terms()) => ({ $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: t, legal: LEGAL });
let counter = 0;
const ev = (kind, effectiveOn, amountMinor, payload = {}, id = `e${(counter += 1)}`) => ({
  $id: id,
  debtId: 'card1',
  kind,
  effectiveOn,
  amountMinor,
  payloadJson: JSON.stringify(payload),
  $createdAt: '2026-01-01T00:00:00.000Z',
});
const pay = (on, amount, id) => ev('payment', on, amount, {}, id);
const row = (projection, period) => projection.plan.find((entry) => entry.period === period);
const withoutNew = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !NEW_FIELDS.includes(key)));
const monthly = periodicRate(EA(28), 'monthly');

// The first two statements of the F3 fixture exactly as the projector returned them before this change.
const FEE_LINES = [
  { id: 'mgmt_fee', kind: 'fee', label: 'Cuota de manejo', display: 'itemized', amountMinor: 9000 },
  { id: 'mgmt_iva', kind: 'tax', label: 'IVA', display: 'itemized', amountMinor: 1710 },
];
const BEFORE = [
  { period: 1, statementOn: '2026-04-15', dueOn: '2026-04-30', interestMinor: 10392, principalMinor: 100000, installmentMinor: 110392, charges: FEE_LINES, chargesMinor: 9000, taxesMinor: 1710, closingMinor: 1721102, statementTotalMinor: 121102, payInFullMinor: 621102, minimumMinor: 146102, totalDueMinor: 146102, paidMinor: 0, outstandingMinor: 146102, paidByEventIds: [], lateInterestMinor: 0, lateMinor: 0, lateDays: 0, lateBaseMinor: 125000, status: 'pastDue' },
  { period: 2, statementOn: '2026-05-15', dueOn: '2026-05-30', interestMinor: 10392, principalMinor: 100000, installmentMinor: 110392, charges: FEE_LINES, chargesMinor: 9000, taxesMinor: 1710, closingMinor: 1742204, statementTotalMinor: 121102, payInFullMinor: 742204, minimumMinor: 146102, totalDueMinor: 146102, paidMinor: 0, outstandingMinor: 146102, paidByEventIds: [], lateInterestMinor: 0, lateMinor: 0, lateDays: 0, lateBaseMinor: 125000, status: 'pastDue' },
];

describe('card statement bases: additive', () => {
  it('keeps every pre-existing plan-row field of the F3 fixture with the same value', () => {
    const projection = project(debt(), [], '2026-06-20');
    expect(projection.plan.slice(0, 2).map(withoutNew)).toEqual(BEFORE);
    expect(row(projection, 1).interestMinor).toBe(fixture.statement1.interestMinor);
  });

  it('adds the three fields as non-negative whole minor units on every row', () => {
    const projection = project(debt(), [], '2026-06-20');
    expect(projection.plan.length).toBeGreaterThanOrEqual(3);
    for (const entry of projection.plan) {
      for (const field of NEW_FIELDS) {
        expect(Number.isInteger(entry[field]), `${field} of period ${entry.period}`).toBe(true);
        expect(entry[field]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('card statement bases: revolving and excluded', () => {
  it('shows the whole unpaid statement as the revolving base, and the interest computed on it', () => {
    const projection = project(debt(), [], '2026-05-20');
    expect(row(projection, 1)).toMatchObject({ revolvingBaseMinor: 500_000, excludedBaseMinor: 0, lateExcludedBaseMinor: 0 });
    expect(row(projection, 2)).toMatchObject({ revolvingBaseMinor: 500_000, excludedBaseMinor: 0, interestMinor: fixture.statement1.interestMinor });
  });

  it('keeps 300,000 unpaid after the due date as the revolving base and the paid part as excluded', () => {
    const { paymentMinor, revolvingMinor, nextInterestMinor } = fixture.unpaid300k;
    const second = row(project(debt(), [pay('2026-04-28', paymentMinor, 'part')], '2026-05-20'), 2);
    expect(second).toMatchObject({ revolvingBaseMinor: revolvingMinor, excludedBaseMinor: 200_000, lateExcludedBaseMinor: 0, interestMinor: nextInterestMinor });
  });

  it('gives a revolving base of 0, an excluded base of 800,000 and no interest when the statement is paid in full by its due date', () => {
    const card = debt(plain(800_000));
    const first = row(project(card, [], '2026-04-20'), 1);
    expect(first.revolvingBaseMinor).toBe(800_000);
    const second = row(project(card, [pay(first.dueOn, first.payInFullMinor, 'full')], '2026-05-20'), 2);
    expect(second).toMatchObject({ revolvingBaseMinor: 0, excludedBaseMinor: 800_000, lateExcludedBaseMinor: 0, interestMinor: 0 });
  });

  it('keeps paying in full after the due date out of the excluded base when it is the clamped due day case', () => {
    // Statement 30 and due 31 meet on 28 February: no due mark falls inside the next cycle, so the base is the balance at the close.
    const card = debt(plain(800_000, { openedOn: '2026-01-05' }, { statementDay: 30, dueDay: 31 }));
    const february = row(project(card, [], '2026-02-28'), 2);
    expect(february.statementOn).toBe(february.dueOn);
    const paid = row(project(card, [pay('2026-03-10', february.payInFullMinor, 'full')], '2026-03-30'), 3);
    expect(paid).toMatchObject({ revolvingBaseMinor: 0, excludedBaseMinor: 800_000, interestMinor: 0 });
    const unpaid = row(project(card, [], '2026-03-30'), 3);
    expect(unpaid).toMatchObject({ revolvingBaseMinor: 800_000, excludedBaseMinor: 0 });
    expect(unpaid.interestMinor).toBe(Math.round(800_000 * monthly));
  });
});

describe('card statement bases: mora capital left out', () => {
  // Statement on the 20th, due on the 10th of the next month: the unmet 125,000 of capital runs mora for the 10 days to the close.
  const mora = (late) => terms({ late }, { statementDay: 20, dueDay: 10 });

  it('matches the F3 interest drop from 10,392 to 9,526 and reports the capital that ran mora', () => {
    const without = row(project(debt(mora(NO_MORA)), [], '2026-05-20'), 2);
    const withMora = row(project(debt(mora(USURY)), [], '2026-05-20'), 2);
    expect(without).toMatchObject({ interestMinor: 10_392, revolvingBaseMinor: 500_000, lateExcludedBaseMinor: 0 });
    expect(withMora).toMatchObject({ interestMinor: 9_526, revolvingBaseMinor: 458_333, lateExcludedBaseMinor: 41_667, excludedBaseMinor: 0 });
    expect(withMora.revolvingBaseMinor + withMora.lateExcludedBaseMinor).toBe(500_000);
  });

  it('prorates the excluded capital by the days the mora ran over the days of the cycle', () => {
    const grace = row(project(debt(terms({ late: { mode: 'usury', graceDays: 5 } }, { statementDay: 20, dueDay: 10 })), [], '2026-05-20'), 2);
    expect(grace.lateExcludedBaseMinor).toBe(Math.round((125_000 * 5) / 30));
    expect(grace.revolvingBaseMinor).toBe(500_000 - grace.lateExcludedBaseMinor);
  });
});

describe('card statement bases: seeded property', () => {
  it('keeps the three fields whole and non-negative, and the interest on the revolving base, over random cards', () => {
    const next = mulberry32(20260715);
    const between = (low, high) => low + Math.floor(next() * (high - low + 1));
    let compared = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const statementDay = between(1, 31);
      const dueDay = between(1, 31);
      const late = next() < 0.5 ? USURY : NO_MORA;
      const card = debt(plain(between(2, 20) * 100_000, { openedOn: '2026-01-05', late }, { statementDay, dueDay }));
      const events = [];
      for (const entry of project(card, [], '2026-09-30').plan.slice(0, 5)) {
        const roll = next();
        if (roll < 0.4) events.push(pay(entry.dueOn, entry.payInFullMinor, `f${entry.period}`));
        else if (roll < 0.7) events.push(pay(entry.dueOn, between(1, 5) * 10_000, `p${entry.period}`));
      }
      for (const entry of project(card, events, '2026-09-30').plan) {
        for (const field of NEW_FIELDS) {
          expect(Number.isInteger(entry[field])).toBe(true);
          expect(entry[field]).toBeGreaterThanOrEqual(0);
        }
        expect(Math.abs(entry.interestMinor - entry.revolvingBaseMinor * monthly)).toBeLessThanOrEqual(1);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });
});
