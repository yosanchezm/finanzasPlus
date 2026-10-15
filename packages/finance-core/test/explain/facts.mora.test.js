// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainFacts } from '../../src/explain/explain.js';
import { DUE_ON, GOLDEN_LEGAL, GOLDEN_TERMS, TEN_DAYS_LATE, goldenDebt } from '../helpers/lateGolden.js';
import { reviewedCopy } from '../helpers/explainCopy.js';
import { deepFreeze, ev, french } from '../helpers/loans.js';

const copy = reviewedCopy();
const facts = (row, today, legal = GOLDEN_LEGAL, events = []) => explainFacts('mora', row, events, legal, today, { copy });
const codes = (result) => result.notices.map((notice) => notice.code);
const cardTerms = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms;
const card = { $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: cardTerms };

describe('explain facts: mora', () => {
  it('shows the mora of 199,505 overdue 10 days at 28.59 % EA as the core computes it: 1,375', () => {
    const result = facts(goldenDebt(), TEN_DAYS_LATE);

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { id: 'd1', kind: 'loan' } });
    expect(result.numbers).toMatchObject({ lateMinor: 1375, lateDays: 10, lateBaseMinor: 199505, lateEA: 28.59 });
    expect(result.text).toMatchObject({ mode: 'usury', lateEA: '28,59 %', late: '$ 1.375', base: '$ 199.505', days: '10' });
    expect(result.approximate).toEqual([]);
    expect(codes(result)).toEqual([]);
  });

  it('grows with the days overdue and keeps the base: 30 days give 4,125', () => {
    const result = facts(goldenDebt(), '2026-03-17');

    expect(result.numbers).toMatchObject({ lateMinor: 4125, lateDays: 30, lateBaseMinor: 199505 });
    expect(result.text.late).toBe('$ 4.125');
  });

  it('offers an approximate example of 10 days when nothing is overdue yet', () => {
    const result = facts(goldenDebt(), DUE_ON);

    expect(result.numbers.lateMinor).toBeUndefined();
    expect(result.numbers).toMatchObject({ exampleDays: 10, exampleBaseMinor: 199505, exampleLateMinor: 1375 });
    expect(result.text).toMatchObject({ exampleDays: '10', exampleBase: '$ 199.505', exampleLate: '$ 1.375' });
    expect(result.approximate).toEqual(['exampleLate']);
  });

  it('reports a debt with no mora policy without a rate or an example', () => {
    const result = facts(goldenDebt({ ...GOLDEN_TERMS, late: { mode: 'none' } }), TEN_DAYS_LATE);

    expect(result.status).toBe('ok');
    expect(result.text.mode).toBe('none');
    expect(result.numbers).toEqual({});
  });

  it('states a fixed rate capped by usury', () => {
    const result = facts(goldenDebt({ ...GOLDEN_TERMS, late: { mode: 'fixed', rate: { convention: 'EA', value: 20 } } }), TEN_DAYS_LATE);

    expect(result.text).toMatchObject({ mode: 'fixed', lateEA: '20 %' });
    expect(result.numbers.lateMinor).toBeLessThan(1375);
  });

  it('carries the cap and mortgage notices of the core', () => {
    expect(codes(facts(goldenDebt(), '2027-02-05'))).toEqual(['late_cap_stale']);
    expect(codes(facts(goldenDebt(french({ kind: 'mortgage', late: { mode: 'usury' } })), TEN_DAYS_LATE))).toEqual(['late_cap_unknown', 'late_mortgage_unverified']);
  });

  it('is generic with no figures when there is no debt', () => {
    expect(facts(null, TEN_DAYS_LATE)).toMatchObject({ status: 'generic', dataSource: 'generic', numbers: {}, text: {} });
  });

  it('gives a card without a mora policy only the policy', () => {
    const result = facts(card, '2026-05-20');

    expect(result.status).toBe('ok');
    expect(result.debt.kind).toBe('card');
    expect(result.text.mode).toBe('none');
    expect(result.numbers.lateMinor).toBeUndefined();
    expect(result.numbers.exampleLateMinor).toBeUndefined();
  });

  it('does not change frozen inputs', () => {
    expect(() => facts(deepFreeze(goldenDebt()), TEN_DAYS_LATE, GOLDEN_LEGAL, deepFreeze([]))).not.toThrow();
  });

  describe('card (mora on the unmet capital of the minimum payment)', () => {
    // Statement on the 20th, due on the 10th of the next month: the unmet minimum of 146,102 holds 21,102 of interest,
    // fees and taxes, so 125,000 of capital runs mora for the 10 days to the next close: 861, billed there.
    const withMora = (late = { mode: 'usury', graceDays: 0 }) => ({ ...card, terms: { ...cardTerms, late, card: { ...cardTerms.card, statementDay: 20, dueDay: 10 } } });

    it('shows the mora of the unmet capital of the minimum as approximate: 125,000 for 10 days gives 861', () => {
      const result = facts(withMora(), '2026-05-20');

      expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { kind: 'card' } });
      expect(result.numbers).toMatchObject({ lateMinor: 861, lateDays: 10, lateBaseMinor: 125000, lateEA: 28.59, minimum: 146102, nonCapital: 21102, capital: 125000 });
      expect(result.text).toMatchObject({ mode: 'usury', late: '$ 861', days: '10', base: '$ 125.000', minimum: '$ 146.102', nonCapital: '$ 21.102', capital: '$ 125.000', lateEA: '28,59 %' });
      expect(result.approximate).toEqual(['late']);
    });

    it('shows a smaller base once part of the minimum is paid, and the mora accrued so far', () => {
      const result = facts(withMora(), '2026-05-15', GOLDEN_LEGAL, [ev('payment', '2026-05-12', 46102, {}, 'p1')]);

      expect(result.numbers).toMatchObject({ lateBaseMinor: 100000, lateDays: 5, minimum: 146102 });
      expect(result.text.base).toBe('$ 100.000');
    });

    it('offers an approximate example when the due date has not come yet', () => {
      const result = facts(withMora(), '2026-04-22');

      expect(result.numbers.lateMinor).toBeUndefined();
      expect(result.numbers).toMatchObject({ exampleDays: 10, exampleBaseMinor: 125000, exampleLateMinor: 861, minimum: 146102, capital: 125000 });
      expect(result.approximate).toEqual(['exampleLate']);
    });

    it('keeps the policy only when the card has no statement yet', () => {
      const result = facts(withMora(), '2026-04-10');

      expect(result.status).toBe('ok');
      expect(result.numbers).toEqual({ lateEA: 28.59 });
    });
  });
});
