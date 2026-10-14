import { resolveLegal } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { CHARGE_PRESETS, evaluate, initialWizard, rateEcho, stepsFor, toTerms, wizardReducer } from './wizardModel';

const TODAY = '2026-10-12';
const run = (actions, start = initialWizard(TODAY)) => actions.reduce(wizardReducer, start);
const fill = (kind, patch = {}, extra = []) => run([
  { type: 'kind', kind },
  { type: 'set', patch: { name: 'Crédito', principal: '1200000', n: '12', ...patch } },
  ...extra,
]);
const rate = (patch) => ({ type: 'rate', patch });

describe('steps and defaults per kind', () => {
  it('uses the full flow for installment loans and defaults to a French plan', () => {
    const state = run([{ type: 'kind', kind: 'vehicle' }]);

    expect(stepsFor('vehicle')).toEqual(['kind', 'basics', 'rate', 'plan', 'charges', 'review']);
    expect(state).toMatchObject({ kind: 'vehicle', system: 'french', rate: { value: '' } });
  });

  it('defaults a family loan to 0% and drops the charges step; an informal one has no plan at all', () => {
    expect(stepsFor('family')).toEqual(['kind', 'basics', 'rate', 'plan', 'review']);
    expect(run([{ type: 'kind', kind: 'family' }]).rate).toMatchObject({ value: '0', basis: 'effective', periodicity: 'annual' });
    expect(stepsFor('informal')).toEqual(['kind', 'basics', 'review']);
    expect(run([{ type: 'kind', kind: 'informal' }])).toMatchObject({ system: 'none', rate: { value: '0' } });
  });

  it('starts leasing with a balloon plan and an irregular debt with a manual plan', () => {
    expect(run([{ type: 'kind', kind: 'leasing' }]).system).toBe('interest_only');
    expect(run([{ type: 'kind', kind: 'other' }]).system).toBe('manual');
  });

  it('keeps what was typed when the same kind is picked again, and resets it for another kind', () => {
    const typed = [{ type: 'kind', kind: 'consumer' }, rate({ value: '24' })];

    expect(run([...typed, { type: 'kind', kind: 'consumer' }]).rate.value).toBe('24');
    expect(run([...typed, { type: 'kind', kind: 'family' }]).rate.value).toBe('0');
  });

  it('moves between the steps of the kind and stops at both ends', () => {
    const start = run([{ type: 'kind', kind: 'informal' }]);
    const at = (...moves) => moves.reduce((state, to) => wizardReducer(state, { type: 'step', to }), start).step;

    expect(at('next', 'next')).toBe('review');
    expect(at('next', 'next', 'next')).toBe('review');
    expect(at('next', 'back', 'back', 'back')).toBe('kind');
  });
});

describe('toTerms', () => {
  it('builds valid French terms from a rate in any convention', () => {
    const terms = toTerms(fill('consumer', { principal: '10000000', n: '36' }, [rate({ value: '25.2', basis: 'nominal', periodicity: 'monthly' })]));

    expect(terms).toMatchObject({
      kind: 'consumer', principalMinor: 10000000, system: 'french', n: 36, periodicity: 'monthly',
      rate: { value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' }, firstDueOn: '2026-11-12',
    });
  });

  it('supports German mortgages, leasing balloons and graced plans', () => {
    const mortgage = fill('mortgage', {}, [rate({ value: '12' }), { type: 'set', patch: { system: 'german', grace: { periods: '2', type: 'principal' } } }]);
    expect(toTerms(mortgage)).toMatchObject({ system: 'german', grace: { periods: 2, type: 'principal' } });

    const leasing = fill('leasing', { balloon: '300000' }, [rate({ value: '15' })]);
    expect(toTerms(leasing)).toMatchObject({ system: 'interest_only', balloonMinor: 300000 });
  });

  it('keeps a family loan interest-free with a manual plan, and an informal one without a schedule', () => {
    const manual = fill('family', { system: 'manual', manualPlan: [{ dueOn: '2026-12-01', amount: '400000' }, { dueOn: '2027-03-01', amount: '800000' }] });
    expect(toTerms(manual)).toMatchObject({ system: 'manual', manualPlan: [['2026-12-01', 400000], ['2027-03-01', 800000]], n: 2, rate: { value: 0 } });

    const informal = toTerms(fill('informal'));
    expect(informal).toMatchObject({ system: 'none', rate: { value: 0 } });
    expect(informal.n).toBeUndefined();
  });

  it('turns charge presets into ordered charges the core accepts', () => {
    const state = fill('libranza', {}, [
      rate({ value: '20' }),
      { type: 'charge', key: 'gmf', value: '0.4' },
      { type: 'charge', key: 'fee', value: '10000' },
      { type: 'charge', key: 'iva', value: '19' },
      { type: 'charge', key: 'life', value: '0.05' },
    ]);

    expect(toTerms(state).charges).toEqual([
      expect.objectContaining({ id: 'life', kind: 'insurance', basis: 'pctOutstanding', value: 0.05 }),
      expect.objectContaining({ id: 'fee', kind: 'fee', basis: 'fixed', value: 10000 }),
      expect.objectContaining({ id: 'iva', kind: 'tax', basis: 'pctOfCharge', refId: 'fee', value: 19 }),
      expect.objectContaining({ id: 'gmf', kind: 'tax', basis: 'pctOfSubtotal', value: 0.4 }),
    ]);
  });

  it('only allows IVA while the fee it applies to exists', () => {
    const withoutFee = run([{ type: 'charge', key: 'iva', value: '19' }]);
    const both = run([{ type: 'charge', key: 'fee', value: '10000' }, { type: 'charge', key: 'iva', value: '19' }]);

    expect(withoutFee.charges).toEqual({});
    expect(both.charges).toEqual({ fee: '10000', iva: '19' });
    expect(wizardReducer(both, { type: 'charge', key: 'fee', value: null }).charges).toEqual({});
    expect(CHARGE_PRESETS.map((preset) => preset.key)).toEqual(['life', 'insurance', 'fee', 'iva', 'gmf']);
  });
});

describe('evaluate', () => {
  it('previews the first installment and the totals of a 0% French loan, with zero interest', () => {
    const result = evaluate(fill('family'));

    expect(result.issues).toEqual([]);
    expect(result.summary).toMatchObject({ count: 12, interestMinor: 0, firstDueOn: '2026-11-12', firstDueMinor: 100000, totalDueMinor: 1200000 });
  });

  it('adds interest and charges to the preview', () => {
    const result = evaluate(fill('consumer', { principal: '1000000', n: '2' }, [rate({ value: '10' }), { type: 'charge', key: 'fee', value: '5000' }]));

    expect(result.summary.interestMinor).toBeGreaterThan(0);
    expect(result.summary.firstDueMinor).toBeGreaterThan(500000 + 5000);
    expect(result.summary.costMinor).toBe(result.summary.interestMinor + 10000);
  });

  it.each([
    ['a negative principal', { principal: '-5' }, [], 'basics', 'El monto del préstamo debe ser mayor que cero.'],
    ['a missing name', { name: ' ' }, [], 'basics', 'Escribe un nombre para la deuda.'],
    ['an anticipated rate of 100%', {}, [rate({ value: '100', timing: 'advance', periodicity: 'monthly' })], 'rate', null],
    ['a missing rate', {}, [rate({ value: '' })], 'rate', 'Escribe la tasa de interés (0 si no cobra intereses).'],
    ['a charge without a value', {}, [{ type: 'charge', key: 'fee', value: '' }], 'charges', null],
  ])('reports %s on the right step', (_label, patch, extra, step, message) => {
    const base = fill('consumer', patch, [rate({ value: '20' }), ...extra]);
    const [issue] = evaluate(base).issues;

    expect(issue.step).toBe(step);
    if (message) expect(issue.message).toBe(message);
    else expect(issue.message.length).toBeGreaterThan(10);
  });

  it('explains a manual plan that does not cover the interest', () => {
    const state = fill('other', { principal: '1000000', manualPlan: [{ dueOn: '2026-11-01', amount: '1000' }, { dueOn: '2026-12-01', amount: '1000000' }] }, [rate({ value: '24' })]);

    expect(evaluate(state).issues[0]).toEqual({ step: 'plan', message: expect.stringContaining('no alcanza a cubrir los intereses') });
  });
});

describe('rateEcho', () => {
  it('echoes 2.1% monthly as about 28.32% EA and 25.2% nominal monthly as the same cost', () => {
    expect(rateEcho({ value: '2.1', basis: 'effective', periodicity: 'monthly', timing: 'arrears' }, 'consumer', TODAY))
      .toMatchObject({ ok: true, label: '2.1% MV ≈ 28.32% EA', notice: null });
    expect(rateEcho({ value: '25.2', basis: 'nominal', periodicity: 'monthly', timing: 'arrears' }, 'consumer', TODAY).label).toBe('25.2% NAMV ≈ 28.32% EA');
  });

  it('describes a custom convention in Spanish', () => {
    const echo = rateEcho({ value: '6', basis: 'nominal', periodicity: 'bimonthly', timing: 'advance' }, 'consumer', TODAY);

    expect(echo.label).toMatch(/^6% nominal bimestral anticipada ≈ \d+\.\d{2}% EA$/);
  });

  it('warns above the usury cap without marking the rate invalid, and only for the modality with a cap', () => {
    const high = { value: '30', basis: 'effective', periodicity: 'annual', timing: 'arrears' };

    expect(rateEcho(high, 'consumer', TODAY)).toMatchObject({ ok: true, notice: { code: 'usury_above_cap', blocking: false } });
    expect(rateEcho(high, 'mortgage', TODAY).notice).toBeNull();
  });

  it('is not ok for an empty or invalid rate', () => {
    expect(rateEcho({ value: '', basis: 'effective', periodicity: 'annual', timing: 'arrears' }, 'consumer', TODAY).ok).toBe(false);
    expect(rateEcho({ value: '100', basis: 'effective', periodicity: 'monthly', timing: 'advance' }, 'consumer', TODAY).ok).toBe(false);
  });
});

describe('household legal tables in the wizard', () => {
  // Household cap for consumer credit in the opening month: 29.00 % EA (2900 bp) and SMMLV 2026 of 2,000,000.
  const legal = resolveLegal([
    { kind: 'usury', modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2900, source: 'Resolución', verified: true },
    { kind: 'smmlv', modality: 'all', validFrom: '2026-01-01', validTo: '2026-12-31', value: 2000000, source: '', verified: false },
  ]);
  const at = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });

  it('warns against the household cap of 29.00 (not 28.59) and never blocks saving', () => {
    const state = fill('consumer', {}, [rate({ value: '29.5' })]);

    const result = evaluate(state, legal);

    expect(result.issues).toEqual([]);
    expect(result.notices).toEqual([expect.objectContaining({ code: 'usury_above_cap', capEA: 29, blocking: false })]);
    expect(evaluate(state).notices).toEqual([expect.objectContaining({ code: 'usury_above_cap', capEA: 28.59 })]);
  });

  it('stays silent for a rate between the code cap and the household cap, and warns without the household table', () => {
    const state = fill('consumer', {}, [rate({ value: '28.8' })]);

    expect(evaluate(state, legal).notices).toEqual([]);
    expect(evaluate(state).notices).toEqual([expect.objectContaining({ code: 'usury_above_cap', capEA: 28.59 })]);
  });

  it('echoes the household cap while the rate is typed', () => {
    expect(rateEcho(at('29.5'), 'consumer', TODAY, legal)).toMatchObject({ ok: true, notice: { code: 'usury_above_cap', capEA: 29 } });
    expect(rateEcho(at('28.8'), 'consumer', TODAY, legal)).toMatchObject({ ok: true, notice: null });
    expect(rateEcho(at('28.8'), 'consumer', TODAY)).toMatchObject({ ok: true, notice: { capEA: 28.59 } });
  });

  it('uses the household SMMLV for the Ley 1555 threshold of a mortgage', () => {
    const state = fill('mortgage', { principal: '1700000000', n: '180' }, [rate({ value: '12' })]);

    expect(evaluate(state).notices).toEqual([expect.objectContaining({ code: 'ley1555_scope_unverified', thresholdMinor: 1540796400, aboveThreshold: true })]);
    expect(evaluate(state, legal).notices).toEqual([expect.objectContaining({ code: 'ley1555_scope_unverified', thresholdMinor: 1760000000, aboveThreshold: false })]);
  });
});

describe('mora policy in the wizard', () => {
  const late = (patch) => ({ type: 'set', patch: { late: patch } });
  const lateOf = (state, patch) => ({ ...state.late, ...patch });
  const fixedRate = { value: '36', basis: 'effective', periodicity: 'annual', timing: 'arrears' };

  it('presets the mora mode by kind: usury for bank loans, none for family and other', () => {
    expect(run([{ type: 'kind', kind: 'consumer' }]).late.mode).toBe('usury');
    expect(run([{ type: 'kind', kind: 'mortgage' }]).late.mode).toBe('usury');
    expect(run([{ type: 'kind', kind: 'family' }]).late.mode).toBe('none');
    expect(run([{ type: 'kind', kind: 'other' }]).late.mode).toBe('none');
  });

  it('keeps a chosen mode when the same kind is picked again and resets it for another kind', () => {
    const chosen = run([{ type: 'kind', kind: 'consumer' }, { type: 'set', patch: { late: { ...initialWizard(TODAY).late, mode: 'none' } } }]);

    expect(run([{ type: 'kind', kind: 'consumer' }], chosen).late.mode).toBe('none');
    expect(run([{ type: 'kind', kind: 'vehicle' }], chosen).late.mode).toBe('usury');
  });

  it('writes the default policy of a bank loan into the created terms', () => {
    expect(toTerms(fill('consumer', { principal: '10000000' }, [rate({ value: '25' })])).late).toEqual({ mode: 'usury', graceDays: 0 });
  });

  it('writes no policy for a family loan left on none, and none when the user turns a bank loan off', () => {
    expect(toTerms(fill('family', { principal: '500000' })).late).toBeUndefined();
    const off = fill('consumer', { principal: '10000000' }, [rate({ value: '25' })]);
    expect(toTerms({ ...off, late: lateOf(off, { mode: 'none' }) }).late).toBeUndefined();
  });

  it('writes a fixed mora rate and grace days a family loan chose', () => {
    const state = fill('family', { principal: '500000' });
    const terms = toTerms({ ...state, late: lateOf(state, { mode: 'fixed', rate: fixedRate, graceDays: '3' }) });

    expect(terms.late).toEqual({ mode: 'fixed', graceDays: 3, rate: { value: 36, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
  });

  it('asks for the rate of a fixed mora in the plan step, without blocking other steps', () => {
    const state = fill('family', { principal: '500000' });
    const result = evaluate({ ...state, late: lateOf(state, { mode: 'fixed' }) });

    expect(result.issues).toEqual([{ step: 'plan', message: 'Escribe la tasa de la mora.', missing: true }]);
    expect(result.terms).toBeUndefined();
  });

  it('explains an invalid mora in the plan step instead of blaming the interest rate', () => {
    const state = fill('family', { principal: '500000' });
    const zero = evaluate({ ...state, late: lateOf(state, { mode: 'fixed', rate: { ...fixedRate, value: '0' } }) });
    const grace = evaluate({ ...state, late: lateOf(state, { mode: 'usury', graceDays: '120' }) });

    expect(zero.issues).toEqual([{ step: 'plan', message: 'La tasa de la mora debe ser mayor que cero.' }]);
    expect(grace.issues).toEqual([{ step: 'plan', message: 'Los días de gracia deben ser un número entero de 0 a 90.' }]);
  });

  it('is valid with the default policy and leaves a card without a policy', () => {
    const loan = fill('consumer', { principal: '10000000' }, [rate({ value: '25' })]);
    expect(evaluate(loan).issues).toEqual([]);
    expect(evaluate(loan).terms.late).toEqual({ mode: 'usury', graceDays: 0 });

    const card = run([
      { type: 'kind', kind: 'card' },
      { type: 'set', patch: { name: 'Visa', card: { ...initialWizard(TODAY).card, statementDay: '10', dueDay: '25' } } },
      rate({ value: '28' }),
    ]);
    expect(toTerms(card).late).toBeUndefined();
  });
});
