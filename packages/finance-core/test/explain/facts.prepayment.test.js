// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY } from '../../src/explain/copy.js';
import { explainFacts } from '../../src/explain/explain.js';
import { compareStrategies } from '../../src/prepay/compare.js';
import { resolveLegal } from '../../src/legal.js';
import { debt, deepFreeze, ev, french, interestFree, onTime } from '../helpers/loans.js';
import { reviewedCopy } from '../helpers/explainCopy.js';

const copy = reviewedCopy();
const facts = (row, today, events = [], opts = {}, legal = null) => explainFacts('prepayment', row, events, legal, today, { copy, ...opts });
const codes = (result) => result.notices.map((notice) => notice.code);
const paidOne = [ev('payment', '2026-02-15', 100_000, {}, 'p1')];
const CARD = { $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: { ...french(), kind: 'card', card: { statementDay: 20, dueDay: 10, minPayment: { rule: 'installments_due', pct: 0, floorMinor: 0 } } } };

describe('explain facts: prepayment', () => {
  it('golden: 1,200,000 at 0 %, 12 installments, 1 paid, extra 300,000 leaves 8 installments reducing the term and 11 reducing the installment', () => {
    const result = facts(debt(interestFree()), '2026-03-01', paidOne, { amountMinor: 300_000 });

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { kind: 'loan' } });
    expect(result.numbers).toMatchObject({
      amount: 300_000,
      periodsBefore: 11,
      installmentBefore: 100_000,
      termPeriods: 8,
      termInstallment: 100_000,
      termSaved: 0,
      installPeriods: 11,
      installInstallment: 72_727,
      installSaved: 0,
    });
    expect(result.text).toMatchObject({
      amount: '$ 300.000',
      onDate: '1 de marzo de 2026',
      termPeriods: '8',
      installPeriods: '11',
      termInstallment: '$ 100.000',
      installInstallment: '$ 72.727',
    });
    expect(result.approximate).toEqual(['installInstallment']);
    expect(codes(result)).toEqual(['ley1555_scope_unverified']);
  });

  it('agrees with the core comparison of the three strategies', () => {
    const row = debt(french());
    const events = onTime(french(), 12);
    const result = facts(row, '2027-01-20', events, { amountMinor: 2_000_000 });
    const core = compareStrategies(row, events, { amountMinor: 2_000_000, on: '2027-01-20' });

    expect(result.numbers.termPeriods).toBe(core.reduceTerm.after.remainingPeriods);
    expect(result.numbers.installPeriods).toBe(core.reduceInstallment.after.remainingPeriods);
    expect(result.numbers.termInstallment).toBe(core.reduceTerm.after.installmentMinor);
    expect(result.numbers.installInstallment).toBe(core.reduceInstallment.after.installmentMinor);
    expect(result.numbers.termSaved).toBe(core.reduceTerm.savings.interestMinor);
    expect(result.numbers.termSaved).toBeGreaterThan(result.numbers.installSaved);
    expect(result.numbers.installSaved).toBeGreaterThan(0);
    expect(result.approximate).toEqual(['installInstallment', 'termSaved', 'installSaved']);
    expect(codes(result)).toEqual(['ley1555_scope_unverified', 'smmlv_stale']);
  });

  it('states the Ley 1555 reference threshold of 880 minimum wages and whether the original principal is within it', () => {
    const small = facts(debt(french()), '2026-10-13', [], { amountMinor: 1_000_000 });
    const large = facts(debt(french({ principalMinor: 2_000_000_000 })), '2026-10-13', [], { amountMinor: 1_000_000 });

    expect(small.numbers).toMatchObject({ smmlv: 1_750_905, threshold: 1_540_796_400 });
    expect(small.text).toMatchObject({ smmlv: '$ 1.750.905', threshold: '$ 1.540.796.400', scope: 'within', smmlvCount: '880' });
    expect(large.text.scope).toBe('above');
  });

  it('keeps the notice without a threshold when no minimum wage is known for the year', () => {
    const result = facts(debt(french()), '2024-10-13', [], { amountMinor: 1_000_000 }, resolveLegal([], { smmlvTable: [] }));

    expect(codes(result)).toContain('ley1555_scope_unverified');
    expect(result.numbers.threshold).toBeUndefined();
    expect(result.text.scope).toBe('unknown');
  });

  it('notes a stale minimum wage', () => {
    const result = facts(debt(french()), '2027-02-01', onTime(french(), 12), { amountMinor: 1_000_000 });

    expect(codes(result)).toEqual(['ley1555_scope_unverified', 'smmlv_stale']);
    expect(result.numbers.threshold).toBe(1_540_796_400);
  });

  it('says the strategies are identical when the system keeps its term, and still shows the figures', () => {
    const german = french({ system: 'german', n: 24 });
    const result = facts(debt(german), '2026-08-01', onTime(german, 6), { amountMinor: 1_000_000 });

    expect(codes(result)).toContain('strategies_identical');
    expect(result.numbers.termPeriods).toBe(result.numbers.installPeriods);
    expect(result.numbers.termInstallment).toBe(result.numbers.installInstallment);
  });

  it('flags an extra that pays the whole debt off', () => {
    const result = facts(debt(interestFree()), '2026-03-01', paidOne, { amountMinor: 5_000_000 });

    expect(codes(result)).toContain('paid_off');
    expect(result.numbers.termPeriods).toBe(0);
  });

  it('shows the registered prepayment penalty only when there is one', () => {
    const penalized = facts(debt(french({ prepaymentPenaltyPct: 2 })), '2027-01-20', onTime(french(), 12), { amountMinor: 2_000_000 });
    const free = facts(debt(french()), '2027-01-20', onTime(french(), 12), { amountMinor: 2_000_000 });

    expect(codes(penalized)).toContain('penalty_registered');
    expect(penalized.text.penaltyPct).toBe('2 %');
    expect(codes(free)).not.toContain('penalty_registered');
    expect(free.text.penaltyPct).toBeUndefined();
  });

  it('notes a mortgage, whose rules are not computed here', () => {
    const result = facts(debt(french({ kind: 'mortgage', principalMinor: 300_000_000 })), '2026-10-13', [], { amountMinor: 5_000_000 });

    expect(codes(result)).toContain('mortgage');
    expect(result.text.scope).toBe('within');
  });

  it('asks for an amount when none (or an invalid one) was stated, with no comparison figure', () => {
    for (const amountMinor of [undefined, 0, -5]) {
      const result = facts(debt(french()), '2026-10-13', [], { amountMinor });

      expect(result.status).toBe('ok');
      expect(codes(result)).toEqual(['no_amount', 'ley1555_scope_unverified']);
      expect(result.numbers.termPeriods).toBeUndefined();
      expect(result.text.scope).toBe('within');
    }
  });

  it('says there is nothing to prepay on a debt that is already paid off', () => {
    const terms = interestFree({ n: 2, principalMinor: 200_000 });
    const paid = [ev('payment', '2026-02-15', 100_000, {}, 'a1'), ev('payment', '2026-03-15', 100_000, {}, 'a2')];
    const result = facts(debt(terms), '2026-04-01', paid, { amountMinor: 50_000 });

    expect(codes(result)).toContain('nothing_owed');
    expect(result.numbers.termPeriods).toBeUndefined();
  });

  it('is generic with no figure when there is no debt, and does not apply to a card', () => {
    expect(facts(null, '2026-10-13', [], { amountMinor: 300_000 })).toMatchObject({ status: 'generic', debt: null, numbers: {}, text: {} });
    expect(facts(CARD, '2026-10-13', [], { amountMinor: 300_000 })).toMatchObject({ status: 'not_applicable', numbers: {} });
  });

  it('is under review while its copy is not reviewed', () => {
    const unreviewed = Object.fromEntries(Object.entries(EXPLAIN_COPY).map(([key, entry]) => [key, { ...entry, reviewedOn: null, reviewedHash: null }]));
    const result = explainFacts('prepayment', debt(french()), [], null, '2026-10-13', { copy: unreviewed, amountMinor: 1_000_000 });

    expect(result.status).toBe('under_review');
  });

  it('does not mutate its inputs', () => {
    const row = deepFreeze(debt(interestFree()));
    const events = deepFreeze([...paidOne]);
    const before = JSON.stringify([row, events]);

    facts(row, '2026-03-01', events, { amountMinor: 300_000 });

    expect(JSON.stringify([row, events])).toBe(before);
  });
});
