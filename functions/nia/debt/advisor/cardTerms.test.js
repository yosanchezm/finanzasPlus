// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError, normalizeRate } from '../../../../packages/finance-core/index.js';
import { buildCardTerms, buildLoanTerms, buildSetupTerms, lateFor, setupCharges } from './cardTerms.js';

const MV = normalizeRate({ convention: 'MV', value: 2.1 });
const EA_ZERO = normalizeRate({ convention: 'EA', value: 0 });
const card = (patch = {}, cardPatch = {}) => ({
  kind: 'card',
  name: 'Tarjeta Bancolombia',
  lender: 'Bancolombia',
  principalMinor: 0,
  openedOn: '2026-10-13',
  rate: MV,
  rateValue: 2.1,
  n: null,
  periodicity: null,
  system: 'none',
  firstDueOn: null,
  card: { statementDay: 15, dueDay: 30, minRule: 'interest_fees_plus_pct', minPct: null, minFloorMinor: null, ...cardPatch },
  presets: { fee: 45000, iva: 19 },
  charges: [],
  lateStated: null,
  mentions: [],
  ...patch,
});
const loan = (patch = {}) => card({ kind: 'consumer', name: 'Libre inversión', principalMinor: 1200000, rate: EA_ZERO, rateValue: 0, n: 3, system: null, periodicity: null, presets: {}, ...patch });
const codeOf = (run) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.code;
  }
  return null;
};

describe('buildCardTerms', () => {
  it('builds validated card terms: system none, monthly, usury mora, the card charges and the minimum rule', () => {
    const terms = buildCardTerms(card());
    expect(terms).toMatchObject({
      kind: 'card',
      system: 'none',
      periodicity: 'monthly',
      principalMinor: 0,
      openedOn: '2026-10-13',
      rate: { value: 2.1, basis: 'effective', periodicity: 'monthly' },
      late: { mode: 'usury', graceDays: 0 },
      card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 0 }, deferred: [] },
    });
    expect(terms.charges.map((charge) => [charge.id, charge.label, charge.value, charge.refId])).toEqual([
      ['mgmt_fee', 'Cuota de manejo', 45000, undefined],
      ['mgmt_iva', 'IVA', 19, 'mgmt_fee'],
    ]);
    expect(terms.schemaVersion).toBe(1);
  });

  it('never writes a card limit, whatever the case says', () => {
    const terms = buildCardTerms({ ...card(), limitMinor: 5000000, card: { ...card().card, limitMinor: 5000000 } });
    expect(terms.card.limitMinor).toBeUndefined();
  });

  it('takes the stated percentage and floor, and leaves the mora off when the user said none', () => {
    const terms = buildCardTerms(card({ lateStated: 'none' }, { minRule: 'pct_balance', minPct: 3, minFloorMinor: 50000 }));
    expect(terms.card.minPayment).toEqual({ rule: 'pct_balance', pct: 3, floorMinor: 50000 });
    expect(terms.late).toBeUndefined();
  });

  it('keeps the usury default when the user asked for a mora Nia cannot save at creation', () => {
    expect(buildCardTerms(card({ lateStated: 'fixed' })).late).toEqual({ mode: 'usury', graceDays: 0 });
    expect(buildCardTerms(card({ lateStated: 'whole_installment' })).late).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('computes the fee from a price that includes the IVA, rounded: 53,550 gives 45,000 and an IVA of 8,550', () => {
    const terms = buildCardTerms(card({ presets: { fee: 53550, iva: 19, ivaIncluded: true } }));
    expect(terms.charges.map((charge) => charge.value)).toEqual([45000, 19]);
    expect(buildCardTerms(card({ presets: { fee: 50000, ivaIncluded: true } })).charges.map((charge) => charge.value)).toEqual([42017, 19]);
  });

  it('appends the explicit charges and resolves a pctOfCharge by label', () => {
    const charges = [
      { kind: 'insurance', label: 'Seguro de desempleo', basis: 'fixed', value: 12000, cadence: 'per_installment' },
      { kind: 'tax', label: 'IVA del seguro', basis: 'pctOfCharge', value: 19, cadence: 'per_installment', refLabel: 'seguro de desempleo' },
    ];
    const terms = buildCardTerms(card({ presets: {}, charges }));
    expect(terms.charges.map((charge) => [charge.label, charge.refId])).toEqual([['Seguro de desempleo', undefined], ['IVA del seguro', 'c1']]);
  });

  it('refuses what is not decided yet instead of saving a provisional value', () => {
    expect(codeOf(() => buildCardTerms(card({}, { statementDay: null })))).toBe('setup_incomplete');
    expect(codeOf(() => buildCardTerms(card({}, { dueDay: null })))).toBe('setup_incomplete');
    expect(codeOf(() => buildCardTerms(card({}, { minRule: null })))).toBe('setup_incomplete');
    expect(codeOf(() => buildCardTerms(card({}, { minRule: 'unknown' })))).toBe('setup_incomplete');
    expect(codeOf(() => buildCardTerms(card({ rate: null, rateValue: 2 })))).toBe('setup_incomplete');
    expect(codeOf(() => buildCardTerms(card({ presets: { fee: null } })))).toBe('preset_amount_missing');
  });

  it('rejects a dangling reference and an IVA without a fee through the core', () => {
    const dangling = [{ kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, cadence: 'per_installment', refLabel: 'cuota de manejo' }];
    expect(codeOf(() => buildCardTerms(card({ presets: {}, charges: dangling })))).toBe('charge_ref_unknown');
    expect(codeOf(() => buildCardTerms(card({ presets: { iva: 19 } })))).toBe('preset_requires_fee');
  });

  it('lets the core judge the days', () => {
    expect(codeOf(() => buildCardTerms(card({}, { statementDay: 32 })))).toBe('invalid_card');
  });

  it('does not touch the case it receives', () => {
    const input = Object.freeze({ ...card(), card: Object.freeze(card().card), presets: Object.freeze({ fee: 45000, iva: 19 }), charges: Object.freeze([]) });
    expect(() => buildCardTerms(input)).not.toThrow();
  });
});

describe('buildLoanTerms and buildSetupTerms', () => {
  it('applies the French monthly defaults, a first due date one period after opening and the usury mora', () => {
    const terms = buildLoanTerms(loan());
    expect(terms).toMatchObject({ kind: 'consumer', principalMinor: 1200000, system: 'french', periodicity: 'monthly', n: 3, firstDueOn: '2026-11-13', late: { mode: 'usury', graceDays: 0 } });
  });

  it('adds the preset charges, GMF included: a 400,000 installment pays 1,600', () => {
    const terms = buildLoanTerms(loan({ presets: { gmf: true } }));
    expect(terms.charges).toEqual([expect.objectContaining({ id: 'gmf', basis: 'pctOfSubtotal', value: 0.4 })]);
  });

  it('writes no mora for a family loan and honours «none»', () => {
    expect(buildLoanTerms(loan({ kind: 'family' })).late).toBeUndefined();
    expect(buildLoanTerms(loan({ lateStated: 'none' })).late).toBeUndefined();
  });

  it('keeps an informal debt as a balance only', () => {
    const terms = buildLoanTerms(loan({ kind: 'informal', n: null, system: 'none' }));
    expect(terms.system).toBe('none');
  });

  it('refuses a loan with no principal, no term or no rate', () => {
    expect(codeOf(() => buildLoanTerms(loan({ principalMinor: null })))).toBe('setup_incomplete');
    expect(codeOf(() => buildLoanTerms(loan({ n: null })))).toBe('setup_incomplete');
    expect(codeOf(() => buildLoanTerms(loan({ rate: null })))).toBe('setup_incomplete');
  });

  it('picks the builder by kind', () => {
    expect(buildSetupTerms(card()).kind).toBe('card');
    expect(buildSetupTerms(loan()).kind).toBe('consumer');
  });
});

describe('lateFor and setupCharges', () => {
  it('defaults the mora by kind: usury for cards and consumer loans, none for family', () => {
    expect(lateFor(card())).toEqual({ mode: 'usury', graceDays: 0 });
    expect(lateFor(loan())).toEqual({ mode: 'usury', graceDays: 0 });
    expect(lateFor(loan({ kind: 'family' }))).toEqual({ mode: 'none', graceDays: 0 });
    expect(lateFor(card({ lateStated: 'none' }))).toEqual({ mode: 'none', graceDays: 0 });
    expect(lateFor(loan({ kind: 'family', lateStated: 'usury' }))).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('builds the charges of a loan with the preset ids and of a card with the stored card ids', () => {
    expect(setupCharges(loan({ presets: { fee: 10000, iva: 19 } }), { card: false }).map((charge) => charge.id)).toEqual(['fee', 'iva']);
    expect(setupCharges(card(), { card: true }).map((charge) => charge.id)).toEqual(['mgmt_fee', 'mgmt_iva']);
  });
});
