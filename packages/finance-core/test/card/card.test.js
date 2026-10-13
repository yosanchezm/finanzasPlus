// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cycleDates } from '../../src/card/card.js';
import { ValidationError } from '../../src/errors.js';
import { planCommit } from '../../src/ledger/commit.js';
import { project } from '../../src/ledger/project.js';
import { parseTerms, serializeTerms, validateTerms } from '../../src/terms.js';
import { mulberry32 } from '../helpers/prng.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));

const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const terms = (overrides = {}, card = {}) => ({ ...fixture.terms, ...overrides, card: { ...fixture.terms.card, ...card } });
const debt = (t = terms()) => ({ $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: t });
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
const charge = (on, amount, payload, id) => ev('charge', on, amount, payload, id);
const row = (projection, period) => projection.plan.find((entry) => entry.period === period);
const tranche = (projection, id) => projection.tranches.find((entry) => entry.id === id);

describe('cycleDates', () => {
  it('puts the due date in the same month when the due day is later than the statement day', () => {
    expect(cycleDates(15, 30, '2026-04')).toEqual({ statementOn: '2026-04-15', dueOn: '2026-04-30' });
  });

  it('moves the due date to the next month when the due day is not later, and across the year end', () => {
    expect(cycleDates(25, 10, '2026-04')).toEqual({ statementOn: '2026-04-25', dueOn: '2026-05-10' });
    expect(cycleDates(25, 10, '2026-12')).toEqual({ statementOn: '2026-12-25', dueOn: '2027-01-10' });
  });

  it('clamps days beyond the month end, including leap years', () => {
    expect(cycleDates(31, 10, '2026-02')).toEqual({ statementOn: '2026-02-28', dueOn: '2026-03-10' });
    expect(cycleDates(31, 10, '2028-02').statementOn).toBe('2028-02-29');
    expect(cycleDates(5, 31, '2026-02').dueOn).toBe('2026-02-28');
    expect(cycleDates(5, 31, '2026-04').dueOn).toBe('2026-04-30');
  });

  it('rejects days outside 1..31 and malformed months', () => {
    expect(() => cycleDates(0, 10, '2026-04')).toThrow(ValidationError);
    expect(() => cycleDates(15, 32, '2026-04')).toThrow(ValidationError);
    expect(() => cycleDates(15, 30, '2026-13')).toThrow(ValidationError);
    expect(() => cycleDates(15, 30, 'April')).toThrow(ValidationError);
  });
});

describe('card terms', () => {
  const withDeferred = (item) => terms({}, { deferred: [{ id: 'x', label: 'TV', principalMinor: 100_000, n: 6, rate: EA(0), ...item }] });

  it('requires the card block and rejects bad days, rules and purchases', () => {
    const { card, ...withoutCard } = fixture.terms;
    expect(card.statementDay).toBe(15);
    expect(() => validateTerms(withoutCard)).toThrow(/card/);
    expect(() => validateTerms(terms({}, { statementDay: 0 }))).toThrow(ValidationError);
    expect(() => validateTerms(terms({}, { dueDay: 32 }))).toThrow(ValidationError);
    expect(() => validateTerms(terms({}, { minPayment: { rule: 'whatever' } }))).toThrow(ValidationError);
    expect(() => validateTerms(withDeferred({ n: 1 }))).toThrow(ValidationError);
    expect(() => validateTerms(withDeferred({ rate: undefined }))).toThrow(ValidationError);
    expect(validateTerms(withDeferred({})).card.deferred).toHaveLength(1);
  });

  it('applies defaults, normalizes the opening purchases and round-trips through JSON', () => {
    const normalized = validateTerms(terms({}, { minPayment: undefined }));
    expect(normalized.card.minPayment).toEqual({ rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 0 });
    expect(normalized.card.deferred[0]).toMatchObject({ id: 'nevera', n: 12, rate: { value: 0, basis: 'effective' } });
    expect(parseTerms(serializeTerms(fixture.terms))).toEqual(validateTerms(fixture.terms));
  });
});

describe('statements: tranches, interest and management fee', () => {
  const s1 = fixture.statement1;

  it('bills the first statement from an independently computed fixture', () => {
    const projection = project(debt(), [], '2026-04-20');
    expect(projection.plan).toHaveLength(1);
    expect(row(projection, 1)).toMatchObject({
      statementOn: s1.statementOn,
      dueOn: s1.dueOn,
      interestMinor: s1.interestMinor,
      chargesMinor: s1.chargesMinor,
      taxesMinor: s1.taxesMinor,
      principalMinor: s1.deferredMinor,
      statementTotalMinor: s1.totalMinor,
      payInFullMinor: s1.payInFullMinor,
    });
    expect(projection.balanceMinor).toBe(1_700_000 + s1.interestMinor + s1.chargesMinor + s1.taxesMinor);
    expect(projection.card).toMatchObject({ nextStatementOn: '2026-05-15', nextDueOn: '2026-05-30', payInFullMinor: s1.payInFullMinor });
  });

  it('keeps tranches apart: revolving at the card rate and a 12-installment plan at 0%', () => {
    const projection = project(debt(), [], '2026-04-20');
    expect(tranche(projection, 'revolving')).toMatchObject({ type: 'revolving', balanceMinor: 500_000 });
    expect(tranche(projection, 'nevera')).toMatchObject({ type: 'deferred', balanceMinor: 1_200_000, n: 12, installmentsLeft: 11, rate: { value: 0 } });
  });

  it('shows no statement and only the opening balance before the first cut-off date', () => {
    const projection = project(debt(), [], '2026-04-10');
    expect(projection.plan).toHaveLength(0);
    expect(projection.balanceMinor).toBe(1_700_000);
    expect(projection.card.nextStatementOn).toBe('2026-04-15');
  });

  it('bills 12 installments of 100,000 on the deferred plan when each statement is paid in full', () => {
    const events = [];
    for (let k = 0; k < 12; k += 1) {
      const { statementOn, dueOn } = cycleDates(15, 30, `${2026 + Math.floor((3 + k) / 12)}-${String(((3 + k) % 12) + 1).padStart(2, '0')}`);
      events.push(pay(dueOn, project(debt(), events, statementOn).card.payInFullMinor, `p${k}`));
    }
    const projection = project(debt(), events, '2027-03-31');
    expect(projection.plan.map((entry) => entry.principalMinor)).toEqual(Array(12).fill(100_000));
    expect(projection.plan.slice(1).map((entry) => entry.interestMinor)).toEqual(Array(11).fill(0));
    expect(projection.balanceMinor).toBe(0);
    expect(tranche(projection, 'nevera')).toMatchObject({ balanceMinor: 0, installmentsLeft: 0 });
  });

  it('charges no interest when a statement is paid in full by its due date, even with new purchases', () => {
    const events = [pay('2026-04-28', s1.payInFullMinor, 'full'), charge('2026-04-20', 80_000, { trancheType: 'revolving', label: 'Mercado' }, 'buy')];
    const second = row(project(debt(), events, '2026-05-20'), 2);
    expect(second.interestMinor).toBe(fixture.paidInFull2.interestMinor);
    expect(second.statementTotalMinor).toBe(fixture.paidInFull2.totalMinor);
    expect(second.payInFullMinor).toBe(fixture.paidInFull2.totalMinor + 80_000);
  });

  it('charges interest on what is still unpaid after the due date at the next statement', () => {
    const { paymentMinor, revolvingMinor, nextInterestMinor } = fixture.unpaid300k;
    const partial = project(debt(), [pay('2026-04-28', paymentMinor, 'part')], '2026-05-20');
    expect(tranche(partial, 'revolving').balanceMinor).toBe(revolvingMinor);
    expect(row(partial, 2).interestMinor).toBe(nextInterestMinor);
    // Nothing paid: interest on the whole 500,000, and the first statement is still owed.
    const unpaid = project(debt(), [], '2026-05-20');
    expect(row(unpaid, 2).interestMinor).toBe(s1.interestMinor);
    expect(unpaid.card.payInFullMinor).toBe(2 * s1.totalMinor + 500_000);
  });

  it('allocates a payment to fees, interest, the installment due and then revolving, and reports its cost', () => {
    const { paymentMinor, costMinor, balanceMinor } = fixture.afterPartialPayment;
    const projection = project(debt(), [pay('2026-04-20', paymentMinor, 'p1')], '2026-04-20');
    expect(projection.applied[0].allocation).toMatchObject({ charges: 9000, taxes: 1710, interest: 10_392, principal: 178_898, surplus: 0 });
    expect(projection.applied[0].costMinor).toBe(costMinor);
    expect(projection.balanceMinor).toBe(balanceMinor);
    expect(tranche(projection, 'nevera').balanceMinor).toBe(1_100_000);
    expect(tranche(projection, 'revolving').balanceMinor).toBe(421_102);
    expect(projection.totals).toMatchObject({ chargesPaid: 9000, taxesPaid: 1710, interestPaid: 10_392, principalPaid: 178_898, remainingInterest: 0 });
  });

  it('plans a card payment through the shared commit path, with the fee and IVA in the cost row', () => {
    const ctx = { eventId: 'pay1', dedupeKey: 'web:n1', actorId: 'u1', source: 'web' };
    const plan = planCommit(debt(), [], { kind: 'payment', effectiveOn: '2026-04-20', amountMinor: 200_000 }, ctx);
    expect(plan.costMinor).toBe(21_102);
    expect(plan.costRow.data).toMatchObject({ amountMinor: 21_102, source: 'debt', debtId: 'card1' });
  });

  it('opens a deferred tranche from a charge event and keeps each tranche at the rate of its purchase', () => {
    const events = [
      pay('2026-04-28', s1.payInFullMinor, 'full'),
      charge('2026-05-02', 600_000, { trancheType: 'deferred', label: 'Portátil', n: 6, rate: EA(12) }, 'a'),
      charge('2026-05-05', 300_000, { trancheType: 'deferred', label: 'Sofá', n: 3 }, 'b'),
      ev('rate_change', '2026-05-10', 0, { rate: EA(35), mode: 'keep_term' }, 'rc'),
    ];
    const projection = project(debt(), events, '2026-05-20');
    const { sixAt12, threeAt28 } = fixture.tranches;
    expect(tranche(projection, 'ta')).toMatchObject({ type: 'deferred', label: 'Portátil', rate: EA(12), installmentsLeft: 5 });
    expect(tranche(projection, 'tb')).toMatchObject({ rate: EA(28), installmentsLeft: 2 });
    expect(row(projection, 2).interestMinor).toBe(sixAt12.firstInterestMinor + threeAt28.firstInterestMinor);
    const principal = (plan) => plan.installmentMinor - plan.firstInterestMinor;
    expect(row(projection, 2).principalMinor).toBe(100_000 + principal(sixAt12) + principal(threeAt28));
  });

  it('treats a one-installment purchase as an ordinary purchase paid in full by the due date', () => {
    const events = [pay('2026-04-28', s1.payInFullMinor, 'full'), charge('2026-04-20', 800_000, { trancheType: 'deferred', label: 'TV', n: 1 }, 'tv')];
    const second = row(project(debt(), events, '2026-05-20'), 2);
    expect(second.interestMinor).toBe(0);
    expect(second.principalMinor).toBe(100_000);
    expect(second.payInFullMinor).toBe(fixture.paidInFull2.totalMinor + 800_000);
  });

  it('accrues a cash advance from its date, prorated in the first cycle', () => {
    const { principalMinor, rateEA, firstCycleInterestMinor, fullCycleInterestMinor } = fixture.advance;
    const advance = charge('2026-05-03', principalMinor, { trancheType: 'advance', label: 'Avance', rate: EA(rateEA) }, 'adv');
    const projection = project(debt(), [pay('2026-04-28', s1.payInFullMinor, 'full'), advance], '2026-06-20');
    expect(row(projection, 2).interestMinor).toBe(firstCycleInterestMinor);
    expect(row(projection, 3).interestMinor).toBe(fullCycleInterestMinor);
    expect(tranche(projection, 'tadv')).toMatchObject({ type: 'advance', balanceMinor: principalMinor });
  });

  it('never bills interest when every statement is paid in full (seeded, 60 cards)', () => {
    const next = mulberry32(2026);
    let statements = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const statementDay = 1 + Math.floor(next() * 31);
      const dueDay = 1 + Math.floor(next() * 31);
      const deferred = [{ id: 'd', label: 'TV', principalMinor: 100_000 + Math.round(next() * 900_000), n: 2 + Math.floor(next() * 10), rate: { convention: 'ZERO' } }];
      const card = terms({ principalMinor: 0, rate: EA(10 + next() * 40) }, { statementDay, dueDay, deferred });
      const purchase = { trancheType: 'revolving', label: 'Compras' };
      const events = [charge('2026-04-01', 1 + Math.round(next() * 2_000_000), purchase, `s${seed}buy`)];
      for (let k = 0; k < 6; k += 1) {
        const { statementOn, dueOn } = cycleDates(statementDay, dueDay, `2026-${String(4 + k).padStart(2, '0')}`);
        if (statementOn < '2026-04-01') continue;
        events.push(pay(dueOn, project(debt(card), events, statementOn).card.payInFullMinor, `s${seed}p${k}`));
      }
      const projection = project(debt(card), events, '2026-10-31');
      statements += projection.plan.length;
      expect(projection.totals.interestPaid).toBe(0);
      expect(projection.plan.every((entry) => entry.interestMinor === 0)).toBe(true);
    }
    expect(statements).toBeGreaterThan(200);
  });
});
