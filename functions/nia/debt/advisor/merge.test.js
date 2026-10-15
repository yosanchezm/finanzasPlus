// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeRate } from '../../../../packages/finance-core/index.js';
import { compactCase, expandCase, isOtherDebt, mergeCase } from './merge.js';

const MV = normalizeRate({ convention: 'MV', value: 2.1 });
const EA = normalizeRate({ convention: 'EA', value: 30 });
const blank = (patch = {}, cardPatch = {}) => ({
  kind: 'card',
  name: '',
  lender: '',
  principalMinor: 0,
  openedOn: '2026-10-13',
  rate: null,
  rateValue: null,
  n: null,
  periodicity: null,
  system: 'none',
  firstDueOn: null,
  card: { statementDay: null, dueDay: null, minRule: null, minPct: null, minFloorMinor: null, ...cardPatch },
  presets: {},
  charges: [],
  lateStated: null,
  mentions: [],
  ...patch,
});
const stored = (patch = {}, cardPatch = {}) => blank({ name: 'Tarjeta Bancolombia', lender: 'Bancolombia', rate: MV, rateValue: 2.1, presets: { fee: 45000, iva: 19 }, ...patch }, cardPatch);

describe('mergeCase', () => {
  it('returns the extraction, with empty asked and unknown lists, when nothing was stored', () => {
    const merged = mergeCase(null, stored());
    expect(merged).toMatchObject({ name: 'Tarjeta Bancolombia', asked: [], unknown: [] });
  });

  it('fills the nulls of the stored case with later answers and keeps what was already stated', () => {
    const merged = mergeCase(stored(), blank({}, { statementDay: 15, dueDay: 30 }));
    expect(merged.card).toMatchObject({ statementDay: 15, dueDay: 30, minRule: null });
    expect(merged).toMatchObject({ name: 'Tarjeta Bancolombia', rate: MV, presets: { fee: 45000, iva: 19 } });
  });

  it('lets a stated value override the stored one', () => {
    const merged = mergeCase(stored({}, { statementDay: 15 }), blank({ name: 'Visa Gold', rate: EA, rateValue: 30, lateStated: 'none' }, { statementDay: 20 }));
    expect(merged).toMatchObject({ name: 'Visa Gold', rate: EA, rateValue: 30, lateStated: 'none' });
    expect(merged.card.statementDay).toBe(20);
  });

  it('keeps the kind of the stored case and ignores the zero a card extraction carries for the opening balance', () => {
    const merged = mergeCase(stored({ principalMinor: 500000 }), blank({ kind: 'consumer', principalMinor: 0 }));
    expect(merged).toMatchObject({ kind: 'card', principalMinor: 500000 });
    expect(mergeCase(stored({ principalMinor: 500000 }), blank({ principalMinor: 800000 })).principalMinor).toBe(800000);
  });

  it('keeps the plan choices the answer did not mention', () => {
    const base = stored({ kind: 'consumer', system: 'german', periodicity: 'biweekly', n: 12, principalMinor: 1000000 });
    expect(mergeCase(base, blank({ kind: 'consumer', system: null, periodicity: null })).system).toBe('german');
    expect(mergeCase(base, blank({ kind: 'consumer', system: null, periodicity: null, n: 6 }))).toMatchObject({ n: 6, periodicity: 'biweekly' });
  });

  it('completes a rate whose convention was asked: the bare value becomes the normalized rate', () => {
    const asked = stored({ rate: null, rateValue: 2 });
    expect(mergeCase(asked, blank({ rate: MV, rateValue: 2.1 }))).toMatchObject({ rate: MV, rateValue: 2.1 });
    expect(mergeCase(asked, blank())).toMatchObject({ rate: null, rateValue: 2 });
  });

  it('merges presets by key: a number overrides, a missing amount never erases one', () => {
    const merged = mergeCase(stored(), blank({ presets: { fee: null, iva: 16, life: null, gmf: true } }));
    expect(merged.presets).toEqual({ fee: 45000, iva: 16, life: null, gmf: true });
    expect(mergeCase(stored({ presets: { life: null } }), blank({ presets: { life: 0.05 } })).presets).toEqual({ life: 0.05 });
  });

  it('merges the charges by folded label and the mentions as a union', () => {
    const first = stored({ charges: [{ kind: 'insurance', label: 'Seguro de desempleo', basis: 'fixed', value: 8000, cadence: 'per_installment' }], mentions: ['card_limit'] });
    const merged = mergeCase(first, blank({
      charges: [
        { kind: 'insurance', label: 'SEGURO DE DESEMPLEO', basis: 'fixed', value: 9000, cadence: 'per_installment' },
        { kind: 'fee', label: 'Anualidad', basis: 'fixed', value: 90000, cadence: 'annual' },
      ],
      mentions: ['advance_rate', 'card_limit'],
    }));
    expect(merged.charges.map((charge) => [charge.label, charge.value])).toEqual([['SEGURO DE DESEMPLEO', 9000], ['Anualidad', 90000]]);
    expect(merged.mentions).toEqual(['card_limit', 'advance_rate']);
  });

  it('counts a field asked once and not answered as unknown, so creation is blocked', () => {
    const asked = { ...stored(), asked: ['statementDay', 'dueDay', 'minRule'] };
    const merged = mergeCase(asked, blank());
    expect(merged.unknown).toEqual(['statementDay', 'dueDay', 'minRule']);
  });

  it('does not count the fields as unknown while the user is still answering some of them', () => {
    const asked = { ...stored(), asked: ['statementDay', 'dueDay'] };
    const merged = mergeCase(asked, blank({}, { statementDay: 15 }));
    expect(merged.card.statementDay).toBe(15);
    expect(merged.unknown).toEqual([]);
  });

  it('forgets an unknown field as soon as it is answered', () => {
    const blocked = { ...stored(), asked: ['dueDay'], unknown: ['statementDay', 'dueDay'] };
    expect(mergeCase(blocked, blank({}, { dueDay: 30 })).unknown).toEqual(['statementDay']);
    expect(mergeCase({ ...blocked, asked: [] }, blank({}, { statementDay: 15, dueDay: 30 })).unknown).toEqual([]);
  });

  it('does not treat an unrelated unanswered question as unknown', () => {
    const asked = { ...stored(), asked: ['name', 'amount:life'] };
    expect(mergeCase(asked, blank()).unknown).toEqual([]);
  });

  it('keeps the merged case within 1.5 KB for the full Bancolombia case, and does not mutate its inputs', () => {
    const full = stored({
      lender: 'Bancolombia',
      presets: { fee: 45000, iva: 19, ivaIncluded: true, life: 0.05, insurance: 12000, gmf: true },
      charges: [{ kind: 'insurance', label: 'Seguro de desempleo', basis: 'fixed', value: 8000, cadence: 'per_installment' }],
      mentions: ['card_limit', 'advance_rate'],
      lateStated: 'usury',
    }, { statementDay: 15, dueDay: 30, minRule: 'interest_fees_plus_pct', minPct: 5, minFloorMinor: 50000 });
    const frozen = JSON.parse(JSON.stringify(full));
    const merged = mergeCase({ ...full, asked: ['statementDay'], unknown: [] }, blank());
    expect(Buffer.byteLength(JSON.stringify(merged), 'utf8')).toBeLessThanOrEqual(1500);
    expect(full).toEqual(frozen);
  });
});

describe('mergeCase: adjusting an existing debt', () => {
  const adjusting = (patch = {}) => stored({ adjust: true, adjustKind: null, debtRef: 'visa', changeOn: null, ...patch });

  it('keeps the debt, the adjust flag and the kind the user chose across answers', () => {
    const merged = mergeCase(adjusting(), blank({ adjust: false, adjustKind: 'fix', debtRef: '', changeOn: '2026-09-13' }));

    expect(merged).toMatchObject({ adjust: true, adjustKind: 'fix', debtRef: 'visa', changeOn: '2026-09-13' });
  });

  it('does not let a later answer without a kind erase the one already chosen', () => {
    expect(mergeCase(adjusting({ adjustKind: 'change' }), blank({ adjustKind: null })).adjustKind).toBe('change');
  });
});

describe('isOtherDebt: a message about a different debt than the open case', () => {
  const debts = [
    { $id: 'c1', name: 'Visa', kind: 'card', lender: 'Bancolombia', status: 'active' },
    { $id: 'd1', name: 'Crédito Vehículo', kind: 'vehicle', lender: 'Davivienda', status: 'active' },
  ];

  it('is true when the message states another lender, and ignores case, accents and a longer legal name', () => {
    expect(isOtherDebt(stored(), blank({ lender: 'Davivienda' }))).toBe(true);
    expect(isOtherDebt(stored(), blank({ lender: 'bancolombia' }))).toBe(false);
    expect(isOtherDebt(stored({ lender: 'Bancolombia' }), blank({ lender: 'Bancolombia S.A.' }))).toBe(false);
    expect(isOtherDebt(stored({ lender: 'Banco de Bogotá' }), blank({ lender: 'banco de bogota' }))).toBe(false);
  });

  it('is false when either side does not name a lender: a plain answer never changes the debt', () => {
    expect(isOtherDebt(stored(), blank({ lender: '' }, { statementDay: 15 }))).toBe(false);
    expect(isOtherDebt(stored({ lender: '' }), blank({ lender: 'Davivienda' }))).toBe(false);
  });

  it('is true for another kind only when the extraction marks the kind as stated', () => {
    expect(isOtherDebt(stored(), blank({ kind: 'vehicle', kindStated: true }))).toBe(true);
    expect(isOtherDebt(stored(), blank({ kind: 'vehicle' }))).toBe(false); // the default of an answer that did not name a kind
    expect(isOtherDebt(stored(), blank({ kind: 'card', kindStated: true }))).toBe(false);
  });

  it('is true for an adjust that names another registered debt, and false for the same one or for no reference', () => {
    const adjusting = (patch = {}) => stored({ lender: '', adjust: true, adjustKind: null, debtRef: 'visa', changeOn: null, ...patch });
    const message = (debtRef) => blank({ lender: '', adjust: true, debtRef });
    expect(isOtherDebt(adjusting(), message('vehiculo'), { debts })).toBe(true);
    expect(isOtherDebt(adjusting(), message('visa'), { debts })).toBe(false);
    expect(isOtherDebt(adjusting(), message(''), { debts })).toBe(false);
    expect(isOtherDebt(adjusting(), message('vehiculo'), { debts, openDebtId: 'd1' })).toBe(false); // the open case already targets that debt
    expect(isOtherDebt(adjusting(), message('algo que no existe'), { debts: [] })).toBe(false);
  });
});

describe('compactCase and expandCase: the extraction kept inside the pending', () => {
  it('drops what the message did not say and expands to the same case, with today as the opening date', () => {
    const full = blank({ name: 'Visa Gold', lender: 'Davivienda', rate: EA, rateValue: 30, presets: { fee: null, gmf: true }, kindStated: true }, { statementDay: 20 });
    const compact = compactCase(full);

    expect(compact).toEqual({ kind: 'card', name: 'Visa Gold', lender: 'Davivienda', rate: EA, rateValue: 30, card: { statementDay: 20 }, presets: { fee: null, gmf: true } });
    expect(Buffer.byteLength(JSON.stringify(compact), 'utf8')).toBeLessThan(Buffer.byteLength(JSON.stringify(full), 'utf8') / 2);
    const { kindStated, openedOn, ...rest } = full;
    expect(expandCase(compact, '2026-10-15')).toEqual({ ...rest, openedOn: '2026-10-15' });
  });

  it('keeps the defaults of a loan and the adjust fields of an adjustment', () => {
    const loan = blank({ kind: 'consumer', system: null, principalMinor: 1200000, n: 3, rate: EA, rateValue: 30 });
    expect(expandCase(compactCase(loan), '2026-10-13')).toEqual(loan);
    const adjust = blank({ adjust: true, adjustKind: 'fix', debtRef: 'visa', changeOn: null });
    expect(expandCase(compactCase(adjust), '2026-10-13')).toEqual(adjust);
  });

  it('does not carry the stated-kind marker into the merged case', () => {
    expect(mergeCase(null, blank({ kindStated: true }))).not.toHaveProperty('kindStated');
    expect(mergeCase(stored(), blank({ kindStated: true }))).not.toHaveProperty('kindStated');
  });
});
