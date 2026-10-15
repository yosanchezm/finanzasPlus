// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { explainFacts } from '../../src/explain/explain.js';
import { reviewedCopy } from '../helpers/explainCopy.js';
import { debt, deepFreeze, french } from '../helpers/loans.js';

const TODAY = '2026-10-13';
const copy = reviewedCopy();
const FEE = { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45000 };
const IVA = { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19 };
const withCharges = (charges, overrides = {}) => debt(french({ charges, ...overrides }));
const facts = (row, opts = {}) => explainFacts('charges', row, [], undefined, TODAY, { copy, ...opts });
const cardTerms = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms;

describe('explain facts: charges', () => {
  it('lists a fee of 45,000 with its IVA of 8,550 and points the tax line at the fee', () => {
    const result = facts(withCharges([FEE, IVA]));

    expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { kind: 'loan' } });
    expect(result.numbers).toMatchObject({ lines: 2, l0: 45000, l1: 8550 });
    expect(result.text).toMatchObject({ 'l0.label': 'Cuota de manejo', 'l0.kind': 'fee', 'l0.basis': 'fixed', 'l0.amount': '$ 45.000' });
    expect(result.text).toMatchObject({ 'l1.label': 'IVA', 'l1.kind': 'tax', 'l1.basis': 'pctOfCharge', 'l1.amount': '$ 8.550', 'l1.ref': 'Cuota de manejo', 'l1.pct': '19 %' });
  });

  it('sums the charges and taxes of the next 12 installments and labels the sum approximate', () => {
    const result = facts(withCharges([FEE, IVA]));

    expect(result.numbers).toMatchObject({ yearRows: 12, yearTotal: 12 * 53550 });
    expect(result.text).toMatchObject({ yearTotal: '$ 642.600', yearRows: '12' });
    expect(result.approximate).toEqual(['yearTotal']);
  });

  it('sums only the installments that are left when fewer than 12 remain', () => {
    const result = facts(withCharges([FEE, IVA], { n: 6 }));

    expect(result.numbers).toMatchObject({ yearRows: 6, yearTotal: 6 * 53550 });
  });

  it('shows a percentage of the subtotal with its rate', () => {
    const result = facts(withCharges([{ id: 'gmf', kind: 'tax', label: 'GMF', basis: 'pctOfSubtotal', value: 0.4 }]));

    expect(result.text).toMatchObject({ 'l0.basis': 'pctOfSubtotal', 'l0.pct': '0,4 %', 'l0.kind': 'tax' });
    expect(result.numbers.l0).toBeGreaterThan(0);
  });

  it('says so, with no sum, when the debt has no charges', () => {
    const result = facts(debt(french()));

    expect(result.status).toBe('ok');
    expect(result.notices).toEqual([{ code: 'no_charges' }]);
    expect(result.numbers.lines).toBe(0);
    expect(result.numbers.yearTotal).toBeUndefined();
  });

  it('caps the printed lines and counts the hidden ones', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ id: `c${index}`, kind: 'insurance', label: `Seguro ${index}`, basis: 'fixed', value: 1000 + index }));
    const result = facts(withCharges(many));

    expect(result.numbers).toMatchObject({ lines: 6, hidden: 2 });
    expect(result.text.hidden).toBe('2');
    expect(result.text['l5.label']).toBe('Seguro 5');
    expect(result.text['l6.label']).toBeUndefined();
  });

  it('explains the GMF with its rate and the example from the core: 0.4 % of 400,000 is 1,600', () => {
    const result = facts(withCharges([FEE]));

    expect(result.numbers).toMatchObject({ gmfRate: 0.4, gmfBase: 400000, gmf: 1600 });
    expect(result.text).toMatchObject({ gmfRate: '0,4 %', gmfBase: '$ 400.000', gmf: '$ 1.600' });
  });

  it('is generic without a debt, with the GMF example and an IVA example: 19 % of 10,000 is 1,900', () => {
    const result = facts(null);

    expect(result).toMatchObject({ status: 'generic', dataSource: 'generic', debt: null });
    expect(result.numbers).toEqual({ gmfRate: 0.4, gmfBase: 400000, gmf: 1600, ivaPct: 19, ivaBase: 10000, iva: 1900 });
    expect(result.text).toMatchObject({ iva: '$ 1.900', ivaBase: '$ 10.000', ivaPct: '19 %' });
    expect(result.numbers.lines).toBeUndefined();
  });

  describe('card', () => {
    const card = { $id: 'c1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: cardTerms };
    const onCard = (today, row = card) => explainFacts('charges', row, [], undefined, today, { copy });

    it('lists the fee and the IVA of the last statement and points the tax at the fee', () => {
      const result = onCard('2026-04-20');

      expect(result).toMatchObject({ status: 'ok', dataSource: 'debt', debt: { kind: 'card' } });
      expect(result.numbers).toMatchObject({ lines: 2, l0: 9000, l1: 1710, gmf: 1600 });
      expect(result.text).toMatchObject({ 'l0.label': 'Cuota de manejo', 'l0.amount': '$ 9.000', 'l1.label': 'IVA', 'l1.amount': '$ 1.710', 'l1.basis': 'pctOfCharge', 'l1.pct': '19 %', 'l1.ref': 'Cuota de manejo' });
    });

    it('estimates the year as twelve statements like the last one, marked approximate', () => {
      const result = onCard('2026-04-20');

      expect(result.numbers).toMatchObject({ yearRows: 12, yearTotal: 128_520 });
      expect(result.text).toMatchObject({ yearRows: '12', yearTotal: '$ 128.520' });
      expect(result.approximate).toEqual(['yearTotal']);
    });

    it('reports a card with no charges, and a card with no statement yet', () => {
      const free = onCard('2026-04-20', { ...card, terms: { ...cardTerms, charges: [] } });
      expect(free.notices).toEqual([{ code: 'no_charges' }]);
      expect(free.numbers.lines).toBe(0);
      const early = onCard('2026-04-10');
      expect(early.notices).toEqual([{ code: 'no_statement_yet' }]);
      expect(early.numbers.lines).toBeUndefined();
      expect(early.numbers.gmf).toBe(1600);
    });
  });

  it('does not change frozen inputs', () => {
    expect(() => explainFacts('charges', deepFreeze(withCharges([FEE, IVA])), deepFreeze([]), undefined, TODAY, deepFreeze({ copy }))).not.toThrow();
  });
});
