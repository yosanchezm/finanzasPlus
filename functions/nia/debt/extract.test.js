// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { debtPrompt, normaliseDebtExtraction } from './extract.js';

const TODAY = '2026-10-13';
const norm = (raw) => normaliseDebtExtraction(raw, { today: TODAY });

describe('debtPrompt', () => {
  const debts = [
    { $id: 'd1', name: 'Crédito Vehículo', lender: 'Bancolombia', kind: 'vehicle' },
    { $id: 'd2', name: 'Hipoteca casa', lender: '', kind: 'mortgage' },
  ];
  const history = [
    { role: 'user', content: 'Quiero abonar al carro' },
    { role: 'assistant', content: '¿Cuánto pagaste?' },
  ];
  const prompt = debtPrompt('pagué 500 mil', debts, history, { today: TODAY, timezone: 'America/Bogota', currency: 'COP' });

  it('lists the existing debts so the model can pick a reference', () => {
    expect(prompt).toContain('Crédito Vehículo');
    expect(prompt).toContain('Bancolombia');
    expect(prompt).toContain('Hipoteca casa');
  });

  it('carries the recent conversation and the new message', () => {
    expect(prompt).toContain('Usuario: Quiero abonar al carro');
    expect(prompt).toContain('Nia: ¿Cuánto pagaste?');
    expect(prompt).toContain('pagué 500 mil');
    expect(prompt).toContain(TODAY);
  });

  it('asks only for extraction (no arithmetic, no writes)', () => {
    expect(prompt).toContain('"action"');
    expect(prompt).toContain('"missingFields"');
    expect(prompt).toMatch(/no calcul/i);
  });

  it('says so when there are no debts or history', () => {
    const empty = debtPrompt('hola', [], [], { today: TODAY });

    expect(empty).toContain('No hay deudas registradas');
    expect(empty).toContain('Sin contexto anterior');
  });
});

describe('normaliseDebtExtraction: pay', () => {
  it('reads a complete payment', () => {
    const result = norm({ action: 'pay', debtRef: ' vehículo ', amountMinor: 500000, paidOn: '2026-10-10', strategy: null });

    expect(result).toMatchObject({ action: 'pay', debtRef: 'vehículo', amountMinor: 500000, paidOn: '2026-10-10', strategy: null, missingFields: [], problems: [] });
  });

  it('defaults the date to today and keeps a valid strategy', () => {
    const result = norm({ action: 'pay', debtRef: 'carro', amountMinor: 900000, strategy: 'reduce_term' });

    expect(result.paidOn).toBe(TODAY);
    expect(result.strategy).toBe('reduce_term');
  });

  it('drops a strategy that is not one of the three', () => {
    expect(norm({ action: 'pay', amountMinor: 1000, strategy: 'pay_everything' }).strategy).toBeNull();
  });

  it('rejects a negative amount as something to correct and stays quiet about it being missing', () => {
    const result = norm({ action: 'pay', debtRef: 'carro', amountMinor: -500000 });

    expect(result.problems).toEqual(['negative_amount']);
    expect(result.missingFields).toEqual([]);
    expect(result.amountMinor).toBeNull();
  });

  it('rejects zero and fractional amounts', () => {
    expect(norm({ action: 'pay', amountMinor: 0 }).problems).toEqual(['invalid_amount']);
    expect(norm({ action: 'pay', amountMinor: 1200.5 }).problems).toEqual(['invalid_amount']);
  });

  it('reports a missing amount in missingFields', () => {
    const result = norm({ action: 'pay', debtRef: 'carro', amountMinor: null });

    expect(result.missingFields).toEqual(['amount']);
    expect(result.problems).toEqual([]);
  });

  it('rejects a payment dated in the future and ignores a malformed date', () => {
    expect(norm({ action: 'pay', amountMinor: 1000, paidOn: '2026-11-01' }).problems).toEqual(['future_date']);
    expect(norm({ action: 'pay', amountMinor: 1000, paidOn: 'ayer' }).paidOn).toBe(TODAY);
  });

  it('falls back to pay when the action is unknown but an amount came, else to list', () => {
    expect(norm({ action: 'whatever', amountMinor: 1000 }).action).toBe('pay');
    expect(norm({ action: null }).action).toBe('list');
    expect(norm(null).action).toBe('list');
  });

  it('reads the extra amount of a simulation or an advice request, from extraMinor or amountMinor', () => {
    expect(norm({ action: 'simulate', extraMinor: 2000000 })).toMatchObject({ action: 'simulate', extraMinor: 2000000 });
    expect(norm({ action: 'advise', extraMinor: 500000 })).toMatchObject({ action: 'advise', extraMinor: 500000 });
    expect(norm({ action: 'advise', amountMinor: 750000 })).toMatchObject({ action: 'advise', extraMinor: 750000 });
    expect(norm({ action: 'simulate', extraMinor: 100, amountMinor: 200 }).extraMinor).toBe(100);
    expect(norm({ action: 'advise' })).toMatchObject({ action: 'advise', extraMinor: null });
  });

  it('treats a negative, zero or fractional extra amount as not given', () => {
    for (const extraMinor of [-5, 0, 1.5, '2000000']) expect(norm({ action: 'simulate', extraMinor }).extraMinor).toBeNull();
  });
});

describe('normaliseDebtExtraction: create', () => {
  const loan = {
    action: 'create',
    kind: 'vehicle',
    name: 'Moto',
    lender: 'Bancolombia',
    principalMinor: 10000000,
    rate: { value: 24, period: 'annual', compounding: 'effective', timing: 'arrears', rawText: '24% EA' },
    n: 36,
    periodicity: 'monthly',
    system: 'french',
    firstDueOn: '2026-11-10',
  };

  it('reads a complete loan with an annual effective rate (no convention question)', () => {
    const result = norm(loan);

    expect(result.missingFields).toEqual([]);
    expect(result.needsConvention).toBe(false);
    expect(result.create).toMatchObject({
      kind: 'vehicle', name: 'Moto', lender: 'Bancolombia', principalMinor: 10000000, n: 36, periodicity: 'monthly', system: 'french', firstDueOn: '2026-11-10',
      rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
    });
  });

  it('resolves a fully stated monthly convention (2.1% effective monthly in arrears)', () => {
    const result = norm({ ...loan, rate: { value: 2.1, period: 'monthly', compounding: 'effective', timing: 'arrears' } });

    expect(result.needsConvention).toBe(false);
    expect(result.create.rate).toEqual({ value: 2.1, basis: 'effective', periodicity: 'monthly', timing: 'arrears' });
  });

  it('flags a missing convention when a monthly rate has no stated timing ("2% mensual")', () => {
    const result = norm({ ...loan, rate: { value: 2, period: 'monthly', compounding: null, timing: null, rawText: '2% mensual' } });

    expect(result.needsConvention).toBe(true);
    expect(result.create.rate).toBeNull();
    expect(result.create.rateValue).toBe(2);
    expect(result.missingFields).toEqual([]);
  });

  it('flags a rate with no period at all', () => {
    expect(norm({ ...loan, rate: { value: 18 } }).needsConvention).toBe(true);
  });

  it('treats a 0% rate as interest free (no question)', () => {
    const result = norm({ ...loan, kind: 'family', rate: { value: 0 } });

    expect(result.needsConvention).toBe(false);
    expect(result.create.rate).toEqual({ value: 0, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
  });

  it('defaults a family loan without a rate to interest free but asks the rate of a bank loan', () => {
    expect(norm({ ...loan, kind: 'family', rate: null }).create.rate).toMatchObject({ value: 0 });
    expect(norm({ ...loan, rate: null }).missingFields).toEqual(['rate']);
  });

  it('reports every missing field', () => {
    const result = norm({ action: 'create', kind: 'consumer' });

    expect(result.missingFields).toEqual(['name', 'principal', 'rate', 'term']);
  });

  it('does not ask for a term or rate on an informal debt (balance only)', () => {
    const result = norm({ action: 'create', kind: 'informal', name: 'Préstamo Juan', principalMinor: 300000 });

    expect(result.missingFields).toEqual([]);
    expect(result.create.system).toBe('none');
  });

  it('rejects a negative principal and an anticipated rate of 100%', () => {
    expect(norm({ ...loan, principalMinor: -5 }).problems).toEqual(['negative_amount']);
    expect(norm({ ...loan, rate: { value: 100, period: 'monthly', compounding: 'effective', timing: 'advance' } }).problems).toEqual(['invalid_rate']);
    expect(norm({ ...loan, rate: { value: -3, period: 'annual' } }).problems).toEqual(['invalid_rate']);
  });

  it('points cards to the web instead of creating them', () => {
    expect(norm({ ...loan, kind: 'card' }).problems).toEqual(['card_in_web']);
  });

  it('falls back to a monthly French loan for unknown periodicity and system', () => {
    const result = norm({ ...loan, periodicity: 'hourly', system: 'magic' });

    expect(result.create).toMatchObject({ periodicity: 'monthly', system: 'french' });
  });

  it('caps the charges at 6 and drops invalid ones', () => {
    const charges = Array.from({ length: 8 }, (_, index) => ({ kind: 'insurance', label: `Seguro ${index + 1}`, basis: 'fixed', value: 10000 + index }));
    charges.splice(2, 0, { kind: 'fee', label: 'Roto', basis: 'pctOfNothing', value: 3 }, { kind: 'fee', label: 'Negativo', basis: 'fixed', value: -1 });

    const result = norm({ ...loan, charges });

    expect(result.create.charges).toHaveLength(6);
    expect(result.create.charges.map((charge) => charge.label)).toEqual(['Seguro 1', 'Seguro 2', 'Seguro 3', 'Seguro 4', 'Seguro 5', 'Seguro 6']);
    expect(result.create.charges[0]).toEqual({ id: 'c1', kind: 'insurance', label: 'Seguro 1', basis: 'fixed', value: 10000, cadence: 'per_installment' });
  });
});

describe('legal_rate extraction', () => {
  const legal = (extra = {}) => ({ kind: 'usury', modality: 'consumer', month: 'noviembre', year: null, value: 28.2, ...extra });

  it('reads "la usura de noviembre es 28.2" into a draft with the month resolved against today', () => {
    const result = norm({ action: 'legal_rate', legal: legal() });

    expect(result).toMatchObject({
      action: 'legal_rate',
      legalRate: { kind: 'usury', modality: 'consumer', validFrom: '2026-11-01', validTo: '2026-11-30', value: 2820 },
      missingFields: [],
      problems: [],
    });
  });

  it('resolves a month without a year on both sides of today, and keeps an explicit year', () => {
    expect(norm({ action: 'legal_rate', legal: legal({ month: 'enero' }) }).legalRate.validFrom).toBe('2027-01-01');
    expect(norm({ action: 'legal_rate', legal: legal({ month: 'mayo' }) }).legalRate.validFrom).toBe('2026-05-01');
    expect(norm({ action: 'legal_rate', legal: legal({ year: 2025 }) }).legalRate.validFrom).toBe('2025-11-01');
  });

  it('refuses 2.82 as something to correct and builds no draft', () => {
    const result = norm({ action: 'legal_rate', legal: legal({ value: 2.82 }) });

    expect(result.problems).toEqual(['legal_value_out_of_range']);
    expect(result.legalRate).toBeNull();
  });

  it('reports what the user did not say', () => {
    expect(norm({ action: 'legal_rate', legal: legal({ month: null }) }).missingFields).toEqual(['legal_month']);
    expect(norm({ action: 'legal_rate', legal: null }).missingFields).toEqual(['legal_kind', 'legal_value']);
  });

  it('leaves the draft empty for every other action', () => {
    expect(norm({ action: 'pay', amountMinor: 1000, legal: legal() }).legalRate).toBeNull();
    expect(norm({ action: 'list' }).legalRate).toBeNull();
  });

  it('shows the model only the phrase to copy and says the code resolves the month', () => {
    const prompt = debtPrompt('la usura de noviembre es 28.2', [], [], { today: TODAY });

    expect(prompt).toContain('legal_rate');
    expect(prompt).toContain('"legal"');
    expect(prompt).toMatch(/no conviertas el mes/i);
    expect(prompt).toMatch(/salario mínimo/i);
  });
});

describe('normaliseDebtExtraction: rate_change', () => {
  const change = { action: 'rate_change', debtRef: 'banco', rate: { value: 22, period: 'annual', compounding: 'effective', timing: 'arrears' }, planChange: { effectiveOn: null, mode: null } };

  it('reads the new rate, the effective date (default today) and the mode', () => {
    const result = norm(change);

    expect(result).toMatchObject({ action: 'rate_change', debtRef: 'banco', needsConvention: false, missingFields: [], problems: [] });
    expect(result.planChange).toEqual({ effectiveOn: TODAY, mode: null, rate: { value: 22, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: 22 });
    expect(norm({ ...change, planChange: { effectiveOn: '2026-10-20', mode: 'keep_installment' } }).planChange).toMatchObject({ effectiveOn: '2026-10-20', mode: 'keep_installment' });
  });

  it('asks for the convention when a non-annual rate does not say it, and keeps the stated value', () => {
    const result = norm({ ...change, rate: { value: 2, period: 'monthly', compounding: null, timing: null } });

    expect(result.needsConvention).toBe(true);
    expect(result.planChange).toMatchObject({ rate: null, rateValue: 2 });
    expect(result.missingFields).toEqual([]);
  });

  it('resolves a fully stated monthly rate with no question', () => {
    const result = norm({ ...change, rate: { value: 1.8, period: 'monthly', compounding: 'effective', timing: 'arrears' } });

    expect(result.needsConvention).toBe(false);
    expect(result.planChange.rate).toEqual({ value: 1.8, basis: 'effective', periodicity: 'monthly', timing: 'arrears' });
  });

  it('reports a missing rate and rejects a negative one', () => {
    expect(norm({ ...change, rate: null }).missingFields).toEqual(['rate']);
    expect(norm({ ...change, rate: { value: null } }).missingFields).toEqual(['rate']);
    expect(norm({ ...change, rate: { value: -3, period: 'annual' } }).problems).toEqual(['invalid_rate']);
  });

  it('accepts a zero rate', () => {
    expect(norm({ ...change, rate: { value: 0, period: 'annual' } }).planChange).toMatchObject({ rateValue: 0, rate: { value: 0 } });
  });

  it('drops a mode that is not one of the two and a malformed date', () => {
    expect(norm({ ...change, planChange: { mode: 'shorten', effectiveOn: 'hoy' } }).planChange).toMatchObject({ mode: null, effectiveOn: TODAY });
    expect(norm({ ...change, planChange: null }).planChange).toMatchObject({ mode: null, effectiveOn: TODAY });
  });

  it('teaches the model the action, the plan change fields and that the new rate goes in rate', () => {
    const prompt = debtPrompt('bajó la tasa a 22', [], [], { today: TODAY });

    expect(prompt).toContain('rate_change');
    expect(prompt).toContain('"planChange"');
    expect(prompt).toContain('keep_term');
    expect(prompt).toContain('keep_installment');
    expect(prompt).toMatch(/nueva tasa va en rate/i);
  });
});

describe('normaliseDebtExtraction: charge_change', () => {
  const change = { action: 'charge_change', debtRef: 'carro', planChange: { effectiveOn: null, mode: null, chargeRef: 'seguro de vida', op: 'remove', newValue: null } };

  it('reads the charge, the operation and the value, with the date defaulting to today', () => {
    expect(norm(change)).toMatchObject({ action: 'charge_change', debtRef: 'carro', missingFields: [], problems: [], planChange: { effectiveOn: TODAY, chargeRef: 'seguro de vida', op: 'remove', newValue: null } });
    expect(norm({ ...change, planChange: { chargeRef: 'manejo', op: 'set', newValue: 12000, effectiveOn: '2026-11-01' } }).planChange).toEqual({ effectiveOn: '2026-11-01', chargeRef: 'manejo', op: 'set', newValue: 12000 });
  });

  it('keeps an add request so the handler can send the user to the web', () => {
    expect(norm({ ...change, planChange: { op: 'add', chargeRef: 'seguro de desempleo', newValue: 20000 } })).toMatchObject({ missingFields: [], planChange: { op: 'add' } });
  });

  it('reports what is missing and what is invalid', () => {
    expect(norm({ ...change, planChange: { chargeRef: null, op: 'remove' } }).missingFields).toEqual(['charge']);
    expect(norm({ ...change, planChange: { chargeRef: 'manejo', op: 'set' } }).missingFields).toEqual(['charge_value']);
    expect(norm({ ...change, planChange: { chargeRef: 'manejo', op: 'set', newValue: -1 } }).problems).toEqual(['invalid_amount']);
  });

  it('teaches the model the action, that the charge and the value go in planChange, and not to invent charges', () => {
    const prompt = debtPrompt('quita el seguro de vida del carro', [], [], { today: TODAY });

    expect(prompt).toContain('charge_change');
    expect(prompt).toContain('chargeRef');
    expect(prompt).toContain('"op"');
    expect(prompt).toContain('newValue');
  });
});
