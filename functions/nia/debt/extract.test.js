// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_TOPICS } from '../../../packages/finance-core/index.js';
import { ACTIONS, debtPrompt, normaliseDebtExtraction } from './extract.js';

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

  it('hands a card to the advisor instead of reading it as a loan (the card_in_web problem is gone)', () => {
    const result = norm({ ...loan, kind: 'card' });
    expect(result.problems).toEqual([]);
    expect(result.create).toBeNull();
    expect(result.setup).toMatchObject({ kind: 'card', name: 'Moto' });
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

  it('reads an add as the presets the user named: a fee with its IVA and a missing amount that stays a question', () => {
    const add = (planChange) => norm({ ...change, planChange: { op: 'add', ...planChange } });

    expect(add({ presets: { fee: 45000, iva: true } })).toMatchObject({ missingFields: [], problems: [], planChange: { op: 'add', add: { presets: { fee: 45000, iva: 19 }, charge: null } } });
    expect(add({ presets: { gmf: true, life: 0.05 } }).planChange.add.presets).toEqual({ life: 0.05, gmf: true });
    expect(add({ presets: { life: true } }).missingFields).toEqual(['charge_value']);
    expect(add({ presets: { fee: -5 } }).problems).toEqual(['negative_amount']);
  });

  it('reads an add as explicit fields, and asks which charge when the model gave neither', () => {
    const add = (planChange) => norm({ ...change, planChange: { op: 'add', ...planChange } });

    expect(add({ kind: 'insurance', label: 'Seguro de vida', basis: 'fixed', newValue: 12000, cadence: 'per_installment' }).planChange.add)
      .toEqual({ presets: {}, charge: { kind: 'insurance', label: 'Seguro de vida', basis: 'fixed', value: 12000, cadence: 'per_installment' } });
    expect(add({ kind: 'tax', label: 'Impuesto', basis: 'pctOfCharge', newValue: 10, refLabel: 'Cuota de manejo' }).planChange.add.charge).toMatchObject({ basis: 'pctOfCharge', refLabel: 'Cuota de manejo', cadence: 'per_installment' });
    expect(add({ chargeRef: 'seguro de desempleo', newValue: 20000 }).missingFields).toEqual(['charge_spec']);
    expect(add({ label: 'Seguro', basis: 'fixed' }).missingFields).toEqual(['charge_value']);
  });

  it('teaches the model the add fields: presets or kind, label, basis, cadence and refLabel', () => {
    const prompt = debtPrompt('agrega un seguro de 12 mil', [], [], { today: TODAY });
    const planChangeSchema = prompt.slice(prompt.indexOf('"planChange":'), prompt.indexOf('"late":{'));

    for (const field of ['"presets"', '"kind"', '"label"', '"basis"', '"cadence"', '"refLabel"']) expect(planChangeSchema).toContain(field);
    expect(prompt).toMatch(/agregar un seguro o cargo/i);
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

describe('normaliseDebtExtraction: restructure', () => {
  const change = { action: 'restructure', debtRef: 'credito', rate: { value: null }, charges: [], planChange: { effectiveOn: null, n: 48, system: null, periodicity: null, firstDueOn: '2026-12-05', waiveLate: false } };

  it('reads the term, the first due date and waiveLate, with the date defaulting to today and no rate when none was said', () => {
    const result = norm(change);

    expect(result).toMatchObject({ action: 'restructure', debtRef: 'credito', needsConvention: false, missingFields: [], problems: [] });
    expect(result.planChange).toEqual({ effectiveOn: TODAY, n: 48, system: null, periodicity: null, firstDueOn: '2026-12-05', waiveLate: false });
    const full = norm({ ...change, planChange: { effectiveOn: '2026-11-01', n: 24, system: 'german', periodicity: 'biweekly', firstDueOn: null, waiveLate: true } });
    expect(full.planChange).toEqual({ effectiveOn: '2026-11-01', n: 24, system: 'german', periodicity: 'biweekly', firstDueOn: null, waiveLate: true });
  });

  it('puts a stated rate in the rate field, like a new loan, and asks for the convention when it is not clear', () => {
    const stated = norm({ ...change, rate: { value: 20, period: 'annual' } });
    const unclear = norm({ ...change, rate: { value: 2, period: 'monthly', compounding: null, timing: null } });
    const monthly = norm({ ...change, rate: { value: 1.8, period: 'monthly', compounding: 'effective', timing: 'arrears' } });

    expect(stated.planChange).toMatchObject({ rate: { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, rateValue: 20 });
    expect(stated.needsConvention).toBe(false);
    expect(unclear.needsConvention).toBe(true);
    expect(unclear.planChange).toMatchObject({ rate: null, rateValue: 2 });
    expect(monthly.planChange.rate).toEqual({ value: 1.8, basis: 'effective', periodicity: 'monthly', timing: 'arrears' });
    expect(norm({ ...change, rate: { value: -3, period: 'annual' } }).problems).toEqual(['invalid_rate']);
    expect(norm({ ...change, rate: { value: 0, period: 'annual' } }).planChange).toMatchObject({ rateValue: 0, rate: { value: 0 } });
  });

  it('asks for the number of installments when it is missing or not a positive whole number', () => {
    expect(norm({ ...change, planChange: { ...change.planChange, n: null } }).missingFields).toEqual(['term']);
    expect(norm({ ...change, planChange: { ...change.planChange, n: 0 } }).missingFields).toEqual(['term']);
    expect(norm({ ...change, planChange: { ...change.planChange, n: 12.5 } }).missingFields).toEqual(['term']);
    expect(norm({ ...change, planChange: null }).missingFields).toEqual(['term']);
  });

  it('drops a system, a periodicity and a date it does not recognize, and takes waiveLate only when it is true', () => {
    const result = norm({ ...change, planChange: { n: 12, system: 'balloon', periodicity: 'fortnightly', firstDueOn: 'pronto', waiveLate: 'yes' } });

    expect(result.planChange).toEqual({ effectiveOn: TODAY, n: 12, system: null, periodicity: null, firstDueOn: null, waiveLate: false });
  });

  it('keeps the charges of the new plan when the user states them, and leaves the current ones when not', () => {
    const charges = [{ kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05 }, { kind: 'fee', label: 'Manejo', basis: 'fixed', value: 10000 }];
    const result = norm({ ...change, charges });

    expect(result.planChange.charges).toEqual([
      { id: 'c1', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' },
      { id: 'c2', kind: 'fee', label: 'Manejo', basis: 'fixed', value: 10000, cadence: 'per_installment' },
    ]);
    expect(norm(change).planChange).not.toHaveProperty('charges');
  });

  it('teaches the model the action, that the plan goes in planChange and the rate in rate, and what waiveLate means', () => {
    const prompt = debtPrompt('reestructura a 48 cuotas', [], [], { today: TODAY });

    expect(prompt).toContain('restructure');
    expect(prompt).toContain('waiveLate');
    expect(prompt).toContain('firstDueOn');
    expect(prompt).toMatch(/condon/i);
    expect(prompt).toMatch(/reestructur/i);
  });
});

describe('normaliseDebtExtraction: late_policy (F2)', () => {
  const late = (extra = {}, input = {}) => norm({ action: 'late_policy', debtRef: 'carro', late: { mode: 'usury', ...extra }, ...input });
  const annual = (value) => ({ value, period: 'annual', compounding: null, timing: null });

  it('reads the usury mode with today as the effective date and no grace days', () => {
    const result = late();

    expect(result).toMatchObject({ action: 'late_policy', debtRef: 'carro', needsConvention: false, missingFields: [], problems: [] });
    expect(result.latePolicy).toEqual({ effectiveOn: TODAY, late: { mode: 'usury', graceDays: 0 } });
  });

  it('reads the four modes, each with only its own field', () => {
    expect(late({ mode: 'none' }).latePolicy.late).toEqual({ mode: 'none', graceDays: 0 });
    expect(late({ mode: 'fixed', rate: annual(40) }).latePolicy.late).toEqual({ mode: 'fixed', graceDays: 0, rate: { value: 40, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
    expect(late({ mode: 'contract_multiple', multiple: 1.5 }).latePolicy.late).toEqual({ mode: 'contract_multiple', graceDays: 0, multiple: 1.5 });
    expect(late({ mode: 'usury', multiple: 2, rate: annual(40) }).latePolicy.late).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('keeps a valid effective date and grace days, and falls back to today for a date that is not real', () => {
    expect(late({ effectiveOn: '2026-10-03', graceDays: 5 }).latePolicy).toEqual({ effectiveOn: '2026-10-03', late: { mode: 'usury', graceDays: 5 } });
    expect(late({ effectiveOn: 'mañana' }).latePolicy.effectiveOn).toBe(TODAY);
  });

  it('asks for the mode when the model did not extract a known one', () => {
    expect(late({ mode: null }).missingFields).toEqual(['late_mode']);
    expect(late({ mode: 'abusive' }).missingFields).toEqual(['late_mode']);
    expect(norm({ action: 'late_policy', debtRef: 'carro', late: null }).missingFields).toEqual(['late_mode']);
  });

  it('asks for the rate of a fixed mora and for the multiple of a contract_multiple mora', () => {
    expect(late({ mode: 'fixed' }).missingFields).toEqual(['late_rate']);
    expect(late({ mode: 'contract_multiple' }).missingFields).toEqual(['late_multiple']);
  });

  it('keeps a fixed rate with no stated convention aside and asks for it with the buttons', () => {
    const result = late({ mode: 'fixed', rate: { value: 3, period: 'monthly', compounding: null, timing: null } });

    expect(result.needsConvention).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.latePolicy).toEqual({ effectiveOn: TODAY, late: { mode: 'fixed', graceDays: 0 }, rateValue: 3 });
  });

  it('flags a multiple outside 0-3, grace days outside 0-90 and a fixed rate of zero as problems', () => {
    expect(late({ mode: 'contract_multiple', multiple: 4 }).problems).toEqual(['late_invalid_multiple']);
    expect(late({ mode: 'contract_multiple', multiple: 0 }).problems).toEqual(['late_invalid_multiple']);
    expect(late({ graceDays: 91 }).problems).toEqual(['late_invalid_grace']);
    expect(late({ graceDays: 2.5 }).problems).toEqual(['late_invalid_grace']);
    expect(late({ mode: 'fixed', rate: annual(0) }).problems).toEqual(['late_invalid']);
  });

  it('teaches the model the action and the late object', () => {
    const prompt = debtPrompt('activa mora a la usura', [], [], { today: TODAY });

    expect(prompt).toContain('late_policy');
    expect(prompt).toContain('contract_multiple');
    expect(prompt).toContain('graceDays');
    expect(prompt).toMatch(/mora/i);
  });
});

describe('normaliseDebtExtraction: explain', () => {
  it('lists the explain action, its closed topic enum and the optional debt selector in the prompt', () => {
    const prompt = debtPrompt('¿qué es la mora?', [], [], { today: TODAY });
    expect(prompt).toContain('explain');
    expect(prompt).toContain('"topic"');
    for (const topic of EXPLAIN_TOPICS) expect(prompt).toContain(topic);
    expect(ACTIONS).toContain('explain');
    expect(ACTIONS).toContain('setup');
    expect(ACTIONS).toContain('terms_correction');
  });

  it('keeps a topic of the closed catalogue, the debt selector, the stated rate and the amount', () => {
    const result = norm({
      action: 'explain',
      topic: 'rate_conventions',
      debtRef: 'el crédito del banco',
      rate: { value: 25.2, period: 'annual', compounding: 'nominal', timing: 'arrears', rawText: '25.2% NAMV' },
      amountMinor: 100000,
    });
    expect(result.action).toBe('explain');
    expect(result.debtRef).toBe('el crédito del banco');
    expect(result.explain).toMatchObject({ topic: 'rate_conventions', amountMinor: 100000 });
    expect(result.explain.stated).toMatchObject({ value: 25.2, basis: 'nominal' });
    expect(result.missingFields).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it.each(EXPLAIN_TOPICS)('accepts the catalogue topic %s', (topic) => {
    expect(norm({ action: 'explain', topic }).explain.topic).toBe(topic);
  });

  it.each([['tax_returns'], [''], [null], [undefined], [42], ['MORA'], ['mora '], [['mora']]])('normalizes the unknown or missing topic %j to no topic', (topic) => {
    const result = norm({ action: 'explain', topic });
    expect(result.action).toBe('explain');
    expect(result.explain.topic).toBeNull();
    expect(result.missingFields).toEqual([]);
  });

  it('carries no stated rate and no amount when the user gave none, and does not create anything', () => {
    const result = norm({ action: 'explain', topic: 'mora' });
    expect(result.explain).toEqual({ topic: 'mora', stated: null, rateValue: null, amountMinor: null });
    expect(result.create).toBeNull();
    expect(result.planChange).toBeNull();
    expect(result.amountMinor).toBeNull();
  });

  it('keeps a stated rate with no convention as a bare value, never as a rate', () => {
    const result = norm({ action: 'explain', topic: 'rate_conventions', rate: { value: 2.1, period: 'monthly', compounding: null, timing: null, rawText: '2,1% mensual' } });
    expect(result.explain.stated).toBeNull();
    expect(result.explain.rateValue).toBe(2.1);
  });

  it('records an invalid amount as a problem instead of carrying it', () => {
    const result = norm({ action: 'explain', topic: 'payment_allocation', amountMinor: -5 });
    expect(result.explain.amountMinor).toBeNull();
    expect(result.problems).toContain('negative_amount');
  });

  it('does not add an explain payload to the other actions', () => {
    expect(norm({ action: 'list' }).explain).toBeNull();
    expect(norm({ action: 'pay', amountMinor: 1000 }).explain).toBeNull();
  });
});

describe('normaliseDebtExtraction: setup (S5a)', () => {
  const MV = { value: 2.1, period: 'monthly', compounding: 'effective', timing: 'arrears', rawText: '2,1% MV' };
  const block = (extra = {}) => ({
    card: { statementDay: null, dueDay: null, minRule: null, minPct: null, minFloorMinor: null },
    presets: { fee: 45000, iva: 19 },
    charges: [],
    lateStated: null,
    mentions: [],
    ...extra,
  });
  const bancolombia = (extra = {}, setup = {}) => ({ action: 'setup', kind: 'card', name: 'Tarjeta Bancolombia', lender: 'Bancolombia', rate: MV, setup: block(setup), ...extra });

  it('lists the setup action and its block in the prompt', () => {
    const prompt = debtPrompt('tarjeta Bancolombia', [], [], { today: TODAY });
    expect(ACTIONS).toContain('setup');
    expect(prompt).toContain('setup');
    expect(prompt).toContain('"presets"');
    expect(prompt).toContain('refLabel');
  });

  it('normalizes the described card to request.setup: statement day, due day and the rule stay null, never defaulted', () => {
    const result = norm(bancolombia());
    expect(result.action).toBe('setup');
    expect(result.create).toBeNull();
    expect(result.missingFields).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.setup).toMatchObject({
      kind: 'card',
      name: 'Tarjeta Bancolombia',
      lender: 'Bancolombia',
      rate: { value: 2.1, basis: 'effective', periodicity: 'monthly', timing: 'arrears' },
      rateValue: 2.1,
      openedOn: TODAY,
      system: 'none',
      card: { statementDay: null, dueDay: null, minRule: null, minPct: null, minFloorMinor: null },
      presets: { fee: 45000, iva: 19 },
      charges: [],
      lateStated: null,
      mentions: [],
    });
  });

  it('reads a card create the same way (kind card on create goes to the advisor)', () => {
    const viaCreate = norm({ ...bancolombia(), action: 'create' });
    expect(viaCreate.action).toBe('create');
    expect(viaCreate.create).toBeNull();
    expect(viaCreate.problems).toEqual([]);
    expect(viaCreate.setup).toEqual(norm(bancolombia()).setup);
  });

  it('reads the statement day, due day, minimum rule, percentage and floor when stated', () => {
    const { setup } = norm(bancolombia({}, { card: { statementDay: 15, dueDay: 30, minRule: 'installments_due', minPct: 3, minFloorMinor: 50000 } }));
    expect(setup.card).toEqual({ statementDay: 15, dueDay: 30, minRule: 'installments_due', minPct: 3, minFloorMinor: 50000 });
  });

  it('keeps «no sé» as the unknown rule and drops a rule outside the catalogue', () => {
    expect(norm(bancolombia({}, { card: { minRule: 'unknown' } })).setup.card.minRule).toBe('unknown');
    expect(norm(bancolombia({}, { card: { minRule: 'whatever' } })).setup.card.minRule).toBeNull();
  });

  it('reports a day outside 1..31 as a problem instead of carrying it', () => {
    const result = norm(bancolombia({}, { card: { statementDay: 40, dueDay: 0 } }));
    expect(result.problems).toEqual(['invalid_day']);
    expect(result.setup.card.statementDay).toBeNull();
    expect(result.setup.card.dueDay).toBeNull();
  });

  it('reads the presets: amounts, the IVA included, GMF, and the key only when the user mentioned it (true: without an amount)', () => {
    const { setup } = norm(bancolombia({}, { presets: { fee: 53550, iva: 19, ivaIncluded: true, life: 0.05, insurance: 12000, gmf: true } }));
    expect(setup.presets).toEqual({ fee: 53550, iva: 19, ivaIncluded: true, life: 0.05, insurance: 12000, gmf: true });
    expect(norm(bancolombia({}, { presets: {} })).setup.presets).toEqual({});
    expect(norm(bancolombia({}, { presets: { fee: true, life: true, gmf: false, insurance: null } })).setup.presets).toEqual({ fee: null, life: null });
  });

  it('turns an IVA stated with no percentage into the default 19 and never invents an amount (true means mentioned without one)', () => {
    const { setup } = norm(bancolombia({}, { presets: { fee: 45000, iva: true, life: true } }));
    expect(setup.presets.iva).toBe(19);
    expect(setup.presets.life).toBeNull();
  });

  it('records an invalid preset amount as a problem', () => {
    expect(norm(bancolombia({}, { presets: { fee: -5 } })).problems).toContain('negative_amount');
    expect(norm(bancolombia({}, { presets: { insurance: 10.5 } })).problems).toContain('invalid_amount');
  });

  it('keeps a pctOfCharge charge with the label of the charge it applies to, and no ids', () => {
    const charges = [
      { kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45000 },
      { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, refLabel: 'cuota de manejo' },
    ];
    const { setup } = norm(bancolombia({}, { presets: {}, charges }));
    expect(setup.charges).toEqual([
      { kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 45000, cadence: 'per_installment' },
      { kind: 'tax', label: 'IVA', basis: 'pctOfCharge', value: 19, cadence: 'per_installment', refLabel: 'cuota de manejo' },
    ]);
  });

  it('drops invalid charges, keeps a valid cadence and caps the list at 6', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ kind: 'insurance', label: `Seguro ${index}`, basis: 'fixed', value: 1000, cadence: 'annual' }));
    const { setup } = norm(bancolombia({}, { presets: {}, charges: [{ kind: 'fee', label: 'Mala', basis: 'weird', value: 1 }, ...many] }));
    expect(setup.charges).toHaveLength(6);
    expect(setup.charges[0].cadence).toBe('annual');
  });

  it('turns a stated card limit into the mention card_limit and never reads limitMinor', () => {
    const result = norm(bancolombia({ limitMinor: 5000000 }, { mentions: ['card_limit', 'advance_rate', 'bogus', 'card_limit'], limitMinor: 5000000 }));
    expect(result.setup.mentions).toEqual(['card_limit', 'advance_rate']);
    expect(result.setup.limitMinor).toBeUndefined();
    expect(result.setup.card.limitMinor).toBeUndefined();
  });

  it('reads what the user said about the mora and drops anything else', () => {
    for (const mode of ['usury', 'fixed', 'none', 'whole_installment']) expect(norm(bancolombia({}, { lateStated: mode })).setup.lateStated).toBe(mode);
    expect(norm(bancolombia({}, { lateStated: 'weekly' })).setup.lateStated).toBeNull();
  });

  it('keeps a stated rate with no convention as a bare value and asks for the convention later', () => {
    const result = norm(bancolombia({ rate: { value: 2, period: 'monthly', compounding: null, timing: null, rawText: '2% mensual' } }));
    expect(result.setup.rate).toBeNull();
    expect(result.setup.rateValue).toBe(2);
    expect(result.needsConvention).toBe(true);
  });

  it('reads a described loan with its plan, and keeps the opening balance of a card optional', () => {
    const loan = norm({ action: 'setup', kind: 'consumer', name: 'Libre inversión', principalMinor: 1200000, rate: { value: 0, period: 'annual' }, n: 3, setup: block({ presets: { gmf: true } }) });
    expect(loan.setup).toMatchObject({ kind: 'consumer', principalMinor: 1200000, n: 3, system: null, periodicity: null, presets: { gmf: true } }); // unspoken plan choices stay null; the advisor applies the defaults
    expect(norm({ action: 'setup', kind: 'consumer', name: 'A', system: 'german', periodicity: 'biweekly' }).setup).toMatchObject({ system: 'german', periodicity: 'biweekly' });
    expect(norm(bancolombia()).setup).toMatchObject({ principalMinor: 0, system: 'none', periodicity: null, n: null });
    expect(norm(bancolombia({ principalMinor: 500000 })).setup.principalMinor).toBe(500000);
  });

  it('survives a model that sends no setup block at all', () => {
    const { setup } = norm({ action: 'setup', kind: 'card', name: 'Visa', rate: MV });
    expect(setup.presets).toEqual({});
    expect(setup.card).toEqual({ statementDay: null, dueDay: null, minRule: null, minPct: null, minFloorMinor: null });
    expect(setup.charges).toEqual([]);
    expect(setup.mentions).toEqual([]);
  });

  it('adds no setup payload to the other actions', () => {
    expect(norm({ action: 'list' }).setup).toBeNull();
    expect(norm({ action: 'create', kind: 'vehicle', name: 'Moto', principalMinor: 1000000, rate: { value: 24, period: 'annual' }, n: 12 }).setup).toBeNull();
  });
});

describe('debtPrompt: a debt in progress', () => {
  it('tells the model which described debt is waiting for answers, only when one is', () => {
    const open = debtPrompt('el corte es el 15', [], [], { today: TODAY, setup: { kind: 'card', name: 'Tarjeta Bancolombia' } });
    expect(open).toContain('Hay una configuración de deuda en curso');
    expect(open).toContain('tarjeta «Tarjeta Bancolombia»');
    expect(open).toContain('action setup');

    const loan = debtPrompt('a 12 cuotas', [], [], { today: TODAY, setup: { kind: 'consumer', name: 'Libre inversión' } });
    expect(loan).toContain('deuda «Libre inversión»');

    expect(debtPrompt('el corte es el 15', [], [], { today: TODAY })).not.toContain('configuración de deuda en curso');
  });
});

describe('normaliseDebtExtraction: terms_correction', () => {
  const fix = (correction = {}, extra = {}) => ({ action: 'terms_correction', debtRef: 'tarjeta', correction, ...extra });

  it('is an action the model can choose, and the prompt teaches the fields it extracts', () => {
    const prompt = debtPrompt('el corte es el 20, no el 15', [], [], { today: TODAY });

    expect(ACTIONS).toContain('terms_correction');
    expect(prompt).toContain('terms_correction');
    expect(prompt).toContain('"correction"');
    expect(prompt).toMatch(/estaba mal desde el inicio/i);
  });

  it('reads the card fields the user corrected and nothing else', () => {
    const result = norm(fix({ statementDay: 20 }));

    expect(result).toMatchObject({ action: 'terms_correction', debtRef: 'tarjeta', missingFields: [], problems: [], correction: { fields: { card: { statementDay: 20 } }, rateValue: null, mentions: [] } });
    expect(norm(fix({ dueDay: 5, minRule: 'pct_balance', minPct: 10, minFloorMinor: 30000 })).correction.fields)
      .toEqual({ card: { dueDay: 5, minPayment: { rule: 'pct_balance', pct: 10, floorMinor: 30000 } } });
  });

  it('reads the rate as the bank states it, or keeps the bare value until the convention button answers', () => {
    const stated = norm(fix({}, { rate: { value: 2.1, period: 'monthly', compounding: 'effective', timing: 'arrears' } }));
    const bare = norm(fix({}, { rate: { value: 2.1, period: 'monthly' } }));

    expect(stated.correction.fields.rate).toMatchObject({ value: 2.1, periodicity: 'monthly' });
    expect(stated.missingFields).toEqual([]);
    expect(bare.correction).toMatchObject({ fields: {}, rateValue: 2.1 });
    expect(bare.missingFields).toEqual([]);
  });

  it('reads a modality by its name and refuses one it does not know', () => {
    expect(norm(fix({ modality: 'bajo monto' })).correction.fields).toEqual({ modality: 'low_amount' });
    expect(norm(fix({ modality: 'productivo rural' })).correction.fields).toEqual({ modality: 'productive_rural' });
    expect(norm(fix({ modality: 'cripto' })).problems).toEqual(['legal_unknown_modality']);
  });

  it('keeps what Nia cannot save yet as mentions, and does not ask what to correct when there is one', () => {
    const result = norm(fix({ mentions: ['card_limit', 'nada'] }));

    expect(result.correction).toMatchObject({ fields: {}, mentions: ['card_limit'] });
    expect(result.missingFields).toEqual([]);
  });

  it('asks what to correct when nothing was stated, and flags impossible days', () => {
    expect(norm(fix({})).missingFields).toEqual(['correction_field']);
    expect(norm(fix({ statementDay: 40 })).problems).toEqual(['invalid_day']);
    expect(norm(fix({ minPct: -3, minRule: 'inventada' })).missingFields).toEqual(['correction_field']);
  });
});
