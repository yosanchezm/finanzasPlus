// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveLegal, serializeTerms } from '../../../packages/finance-core/index.js';
import { buildTerms, previewCreate, previewPay, withConvention } from './preview.js';

const TODAY = '2026-10-13';
const PAY_DAY = '2026-10-05'; // before the first installment: only that installment is due now
const ACTOR = 'telegram:1';
const plain = (text) => text.replace(/ /g, ' ');

// French 10,000,000 at 24% EA, 36 months, first installment 2026-10-10 (380,381 = 180,876 interest + 199,505 principal).
const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debtRow = (terms, extra = {}) => ({ $id: 'db1', householdId: 'h1', name: 'Crédito Vehículo', kind: terms.kind, ownerScope: 'you', status: 'active', termsJson: serializeTerms(terms), ...extra });
const disbursement = { $id: 'e0', debtId: 'db1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', actorId: ACTOR, source: 'telegram', $createdAt: '2026-09-10T12:00:00.000Z' };
const ctx = { eventId: 'dep1', dedupeKey: 'debt:p1', actorId: ACTOR, source: 'telegram' };

const pay = (request, debt = debtRow(loanTerms), events = [disbursement], day = PAY_DAY) => previewPay({ debt, events, request: { paidOn: day, ...request }, today: day, ctx });

describe('previewPay', () => {
  it('splits an installment payment into interest and principal and shows the new balance', () => {
    const result = pay({ amountMinor: 380381 });
    const text = plain(result.text);

    expect(result.ok).toBe(true);
    expect(result.requiresStrategy).toBe(false);
    expect(result.plan.event.data).toMatchObject({ kind: 'payment', amountMinor: 380381, dedupeKey: 'debt:p1', source: 'telegram' });
    expect(result.summary).toEqual({ interest: 180876, charges: 0, principal: 199505, balanceAfter: 9800495 });
    expect(text).toContain('Intereses: $ 180.876');
    expect(text).toContain('Capital: $ 199.505');
    expect(text).toContain('Saldo: $ 10.000.000 → $ 9.800.495');
    expect(text).toContain('Cuotas restantes: 36 → 35');
    expect(text).toContain('Próxima cuota: $ 380.381 el 2026-11-10');
    expect(text).toContain('gasto');
  });

  it('shows the cost row only when there is a cost (interest-free debt: none)', () => {
    const family = { ...loanTerms, kind: 'family', rate: { convention: 'ZERO' }, principalMinor: 1200000, n: 12 };
    const result = pay({ amountMinor: 100000 }, debtRow(family), [{ ...disbursement, amountMinor: 1200000 }]);

    expect(result.ok).toBe(true);
    expect(result.plan.costRow).toBeNull();
    expect(plain(result.text)).not.toContain('gasto');
    expect(result.summary).toMatchObject({ interest: 0, principal: 100000, balanceAfter: 1100000 });
  });

  it('asks for a strategy when the amount is above what is due, and writes nothing yet', () => {
    const result = pay({ amountMinor: 500000 });

    expect(result).toMatchObject({ ok: true, requiresStrategy: true, plan: null, summary: null });
    expect(result.text).toBeNull();
  });

  it('previews an extra payment with the chosen strategy', () => {
    // On 2026-10-13 the first installment is overdue (380,381) and the second is the next one (760,762 due now).
    const result = pay({ amountMinor: 800000, strategy: 'reduce_term' }, debtRow(loanTerms), [disbursement], TODAY);
    const text = plain(result.text);

    expect(result.requiresStrategy).toBe(true);
    expect(result.plan.event.data).toMatchObject({ kind: 'extra_payment', amountMinor: 800000 });
    expect(JSON.parse(result.plan.event.data.payloadJson)).toEqual({ strategy: 'reduce_term' });
    // 380,381 settles the overdue installment (180,876 interest + 199,505 principal); the other 419,619 is extra principal.
    expect(result.summary).toEqual({ interest: 180876, charges: 0, principal: 619124, balanceAfter: 9380876 });
    expect(text).toContain('Estrategia: reducir plazo');
    expect(text).toContain('Saldo: $ 10.000.000 → $ 9.380.876');
  });

  it('never asks for a strategy on a card', () => {
    const card = {
      kind: 'card', principalMinor: 500000, openedOn: '2026-08-01', rate: { convention: 'EA', value: 28 }, system: 'none', periodicity: 'monthly',
      card: { statementDay: 20, dueDay: 5, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 0 } },
    };
    const result = pay({ amountMinor: 900000 }, debtRow(card, { name: 'Visa' }), []);

    expect(result.ok).toBe(true);
    expect(result.requiresStrategy).toBe(false);
    expect(result.plan.event.data.kind).toBe('payment');
  });

  it('reports a core refusal in Spanish instead of throwing', () => {
    const result = pay({ amountMinor: 300000, paidOn: '2026-13-45' });

    expect(result.ok).toBe(false);
    expect(result.issue).toMatch(/fecha|calcular/i);
  });

  it('reports an unreadable debt instead of throwing', () => {
    const result = pay({ amountMinor: 1000 }, { ...debtRow(loanTerms), termsJson: '{not json' });

    expect(result).toMatchObject({ ok: false });
    expect(result.issue).toMatch(/leer/i);
  });
});

describe('buildTerms and previewCreate', () => {
  const create = { kind: 'vehicle', name: 'Moto', lender: 'Bancolombia', principalMinor: 10000000, rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: 24, n: 36, periodicity: 'monthly', system: 'french', firstDueOn: null, charges: [], openedOn: TODAY };

  it('builds valid terms with the first due date one period after today by default', () => {
    expect(buildTerms(create)).toMatchObject({ kind: 'vehicle', principalMinor: 10000000, openedOn: TODAY, system: 'french', n: 36, firstDueOn: '2026-11-13' });
    expect(buildTerms({ ...create, firstDueOn: '2026-11-20' }).firstDueOn).toBe('2026-11-20');
  });

  it('builds balance-only terms for an informal debt', () => {
    const terms = buildTerms({ ...create, kind: 'informal', system: 'none', n: null, rate: { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });

    expect(terms).toMatchObject({ kind: 'informal', system: 'none' });
    expect(terms.n).toBeUndefined();
  });

  it('echoes the rate with its EA equivalent (2.1% MV is about 28.3% EA) and the first installment', () => {
    const result = previewCreate({ ...create, rate: { value: 2.1, basis: 'effective', periodicity: 'monthly', timing: 'arrears' }, rateValue: 2.1 });
    const text = plain(result.text);

    expect(result.ok).toBe(true);
    expect(text).toContain('2.1% MV ≈ 28.32% EA');
    expect(text).toContain('36 cuotas mensuales');
    expect(text).toMatch(/Primera cuota: \$ [\d.]+ el 2026-11-13/);
    expect(result.terms.rate).toEqual({ value: 2.1, basis: 'effective', periodicity: 'monthly', timing: 'arrears' });
  });

  it('adds an informational usury notice that does not block', () => {
    const high = previewCreate({ ...create, rate: { value: 30, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: 30 });
    const low = previewCreate(create);

    expect(high.ok).toBe(true);
    expect(plain(high.text)).toContain('tope de usura');
    expect(plain(high.text)).toContain('informativo');
    expect(plain(low.text)).not.toContain('tope de usura');
  });

  it('adds the Ley 1555 notice for a mortgage', () => {
    const result = previewCreate({ ...create, kind: 'mortgage', system: 'german' });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('Ley 1555');
    expect(plain(previewCreate(create).text)).not.toContain('Ley 1555');
  });

  it('asks for the convention before any preview when it is missing', () => {
    const result = previewCreate({ ...create, rate: null, rateValue: 2 });

    expect(result).toMatchObject({ ok: false, needsConvention: true });
    expect(result.text).toContain('2%');
    expect(result.text).toMatch(/convención|tasa/i);
    expect(result.terms).toBeUndefined();
  });

  it('applies the convention picked with the buttons to the stated value', () => {
    const picked = withConvention({ ...create, rate: null, rateValue: 2 }, 'NAMV');

    expect(picked.rate).toEqual({ value: 2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' });
    expect(previewCreate(picked).ok).toBe(true);
    expect(withConvention({ ...create, rate: null, rateValue: 2 }, 'MV').rate).toMatchObject({ basis: 'effective', periodicity: 'monthly' });
  });

  it('reports invalid terms in Spanish', () => {
    const result = previewCreate({ ...create, principalMinor: 0 });

    expect(result).toMatchObject({ ok: false, issue: 'El monto del préstamo debe ser mayor que cero.' });
  });
});

describe('previewCreate with the household legal tables', () => {
  const create = { kind: 'vehicle', name: 'Moto', lender: 'Bancolombia', principalMinor: 10000000, rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: 24, n: 36, periodicity: 'monthly', system: 'french', firstDueOn: null, charges: [], openedOn: TODAY };
  const at = (value) => ({ ...create, rate: { value, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: value });
  const household = resolveLegal([{ kind: 'usury', modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2900, source: 'Resolución', verified: true }]);
  const UNAVAILABLE = 'No pude leer las tasas legales del hogar';

  it('cites the household cap of 29 % (not the code 28.59 %) and stays silent between the two', () => {
    const above = plain(previewCreate(at(29.5), { legal: household }).text);
    const between = previewCreate(at(28.8), { legal: household });

    expect(above).toContain('supera el tope de usura de 29% E.A.');
    expect(plain(previewCreate(at(29.5)).text)).toContain('supera el tope de usura de 28.59% E.A.');
    expect(between.ok).toBe(true);
    expect(plain(between.text)).not.toContain('tope de usura');
    expect(plain(previewCreate(at(28.8)).text)).toContain('tope de usura de 28.59% E.A.');
  });

  it('appends one notice line when the legal tables were unavailable and the preview cites a cap', () => {
    const text = plain(previewCreate(at(30), { legal: resolveLegal.unavailable() }).text);

    expect(text).toContain('tope de usura de 28.59% E.A.');
    expect(text.split(UNAVAILABLE)).toHaveLength(2);
    expect(text).toContain('usé los valores de la app');
  });

  it('does not mention the unavailable tables when no cap is cited, or when they were read', () => {
    expect(plain(previewCreate(at(24), { legal: resolveLegal.unavailable() }).text)).not.toContain(UNAVAILABLE);
    expect(plain(previewCreate(at(30), { legal: household }).text)).not.toContain(UNAVAILABLE);
    expect(plain(previewCreate(at(30), { legal: resolveLegal([]) }).text)).not.toContain(UNAVAILABLE);
    expect(plain(previewCreate(at(30)).text)).not.toContain(UNAVAILABLE);
  });
});

describe('mora default by kind on a new debt (F2)', () => {
  const create = { kind: 'vehicle', name: 'Moto', lender: '', principalMinor: 10000000, rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: 24, n: 36, periodicity: 'monthly', system: 'french', firstDueOn: null, charges: [], openedOn: TODAY };

  it('writes the usury mora for the bank kinds, with no grace days', () => {
    for (const kind of ['consumer', 'vehicle', 'libranza', 'leasing', 'mortgage']) {
      expect(buildTerms({ ...create, kind }).late).toEqual({ mode: 'usury', graceDays: 0 });
    }
  });

  it('writes no mora for family, informal and other debts, nor for a balance-only debt', () => {
    for (const kind of ['family', 'other']) expect(buildTerms({ ...create, kind })).not.toHaveProperty('late');
    const informal = buildTerms({ ...create, kind: 'informal', system: 'none', n: null, rate: { value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
    expect(informal).not.toHaveProperty('late');
  });

  it('says in the preview that an overdue installment will charge the usury rate, only when the mora is on', () => {
    expect(plain(previewCreate(create).text)).toContain('Mora: si una cuota se vence, cobra la tasa de usura vigente.');
    expect(plain(previewCreate({ ...create, kind: 'family' }).text)).not.toContain('Mora:');
  });
});

describe('previewPay: mora line (F2)', () => {
  const lateDebt = debtRow({ ...loanTerms, late: { mode: 'usury', graceDays: 0 } });
  const TEN_DAYS_LATE = '2026-10-20'; // the installment of 2026-10-10 has 1,375 of mora at the 28.59% cap

  it('shows the mora the payment settles on its own line, apart from the charges', () => {
    const text = plain(pay({ amountMinor: 381756 }, lateDebt, [disbursement], TEN_DAYS_LATE).text);

    expect(text).toContain('Mora: $ 1.375');
    expect(text).toContain('Intereses: $ 180.876');
    expect(text).toContain('Capital: $ 199.505');
    expect(text).not.toContain('Mora pendiente');
    expect(text).not.toContain('Cargos e impuestos');
  });

  it('says how much mora is still owed when the payment does not cover it', () => {
    const text = plain(pay({ amountMinor: 1000 }, lateDebt, [disbursement], TEN_DAYS_LATE).text);

    expect(text).toContain('Mora: $ 1.000');
    expect(text).toContain('Mora pendiente: $ 375');
  });

  it('says nothing about mora when the debt has no mora policy', () => {
    const text = plain(pay({ amountMinor: 380381 }, debtRow(loanTerms), [disbursement], TEN_DAYS_LATE).text);

    expect(text).not.toContain('Mora');
    expect(text).toContain('Capital: $ 199.505');
  });
});
