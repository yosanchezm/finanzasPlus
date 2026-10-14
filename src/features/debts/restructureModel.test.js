import { project, resolveLegal } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { makeDebt, makeEvent, makePayment } from './debtFixtures';
import { PAYLOAD_TOO_LARGE, STEPS, canAdvance, initialRestructureForm, previewRestructure, restructureView, systemsFor } from './restructureModel';

// The reference loan of the plan-change specs: 10,000,000 at 24% EA over 36 months with a 10,000 fee. Its first installment
// (390,381 = principal 199,505 + interest 180,876 + fee 10,000) falls due on 2026-02-05; ten days later the mora is 1,375.
const FEE = { id: 'fee', kind: 'fee', label: 'Comisión', basis: 'fixed', value: 10000, cadence: 'per_installment' };
const LEGAL = resolveLegal([], { usuryTable: [{ modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-12-31', capEA: 28.59, source: 'test', verified: true }] });
const DISBURSEMENT = makeEvent('e0', 'disbursement', '2026-01-05', 10000000);
const DAY_10 = '2026-02-15';

const loan = ({ late, ...terms } = {}) => makeDebt({ principalMinor: 10000000, legal: LEGAL }, { principalMinor: 10000000, n: 36, charges: [FEE], ...(late ? { late } : {}), ...terms });
const USURY = { mode: 'usury' };

// Builds the view as the dialog does: the projection as of today and a form that starts from the terms in force.
const run = ({ debt = loan({ late: USURY }), events = [DISBURSEMENT], today = DAY_10, edit = (form) => form } = {}) => {
  const projection = project(debt, events, today);
  const form = edit(initialRestructureForm(projection, today));
  const view = restructureView({ debt, events, projection, form });
  return { debt, events, projection, form, view, preview: () => previewRestructure({ debt, events, view, form, today }) };
};
const planOf = (patch) => (form) => ({ ...form, ...patch });

describe('initialRestructureForm', () => {
  it('starts today, on the terms in force, with the installments still to pay as the number of installments', () => {
    const { form } = run();

    expect(form).toMatchObject({ effectiveOn: DAY_10, waiveLate: false, system: 'french', periodicity: 'monthly', n: '36', firstDueOn: '', rate: { value: '24' } });
    expect(form.chargeRows.map((row) => [row.id, row.value])).toEqual([['fee', '10000']]);
  });

  it('counts only the installments left, and does not carry the old grace over', () => {
    const { form } = run({ debt: loan({ grace: { periods: 2, type: 'total' } }), today: '2026-02-01' });
    const paid = run({ events: [DISBURSEMENT, makePayment('p1', '2026-02-05', 390381)] });

    expect(form.grace).toEqual({ periods: '0', type: 'total' });
    expect(paid.form.n).toBe('35');
  });

  it('starts a manual plan as a French plan, because its old dates belong to the old calendar', () => {
    const manual = makeDebt({ kind: 'other' }, { kind: 'other', system: 'manual', manualPlan: [['2026-02-05', 600000], ['2026-03-05', 500000]] });

    const { form } = run({ debt: manual, today: '2026-02-01' });

    expect(form).toMatchObject({ system: 'french', manualPlan: [] });
  });
});

describe('systemsFor', () => {
  it('offers the systems of the debt kind, without a manual plan or a missing one', () => {
    expect(systemsFor('consumer')).toEqual(['french', 'german']);
    expect(systemsFor('leasing')).toEqual(['interest_only', 'french']);
    expect(systemsFor('other')).toEqual(['french']);
  });
});

describe('step 1: the situation (DL3)', () => {
  it('lists the arrears with the mora, and the carried balance is exactly their sum', () => {
    const { view } = run();

    const [principal, interest, charges, late] = view.situation.rows;
    expect(view.situation.ok).toBe(true);
    expect([principal.minor, interest.minor, charges.minor, late.minor]).toEqual([10000000, 180876, 10000, 1375]);
    expect(view.situation.rows.map((row) => row.label)).toEqual(['Capital pendiente', 'Intereses vencidos', 'Cargos e impuestos vencidos', 'Intereses de mora']);
    expect(view.situation.totalMinor).toBe(10192251);
    expect(view.situation.rows.reduce((sum, row) => sum + row.minor, 0)).toBe(view.situation.totalMinor);
    expect(view.carriedMinor).toBe(10192251);
  });

  it('shows no mora when the debt has no mora policy, and the sum still holds', () => {
    const { view } = run({ debt: loan() });

    expect(view.situation.rows.map((row) => row.minor)).toEqual([10000000, 180876, 10000, 0]);
    expect(view.carriedMinor).toBe(10190876);
  });

  it('refinances the taxes with the charges, and only what is unpaid after a short payment', () => {
    const taxed = loan({ late: USURY, charges: [FEE, { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' }] });
    const { view } = run({ debt: taxed });
    const short = run({ events: [DISBURSEMENT, makePayment('p1', DAY_10, 100000)] });

    expect(view.situation.rows[2].minor).toBe(11900);
    expect(short.view.situation.rows.map((row) => row.minor)).toEqual([10000000, 92251, 0, 0]); // the payment covers the fee and the mora first
    expect(short.view.carriedMinor).toBe(10092251);
  });

  it('refuses a date that is not real, and a debt with nothing left to refinance', () => {
    const bad = run({ edit: planOf({ effectiveOn: '' }) });
    const single = makeDebt({ principalMinor: 1000000, legal: LEGAL }, { n: 1, charges: [] });
    const first = makeEvent('e0', 'disbursement', '2026-01-05', 1000000);
    const settled = run({ debt: single, events: [first, makePayment('p1', '2026-02-05', project(single, [first], '2026-02-05').plan[0].totalDueMinor)], today: '2026-02-05' });

    expect(bad.view.situation.ok).toBe(false);
    expect(canAdvance('situation', bad.view)).toBe(false);
    expect(settled.view.situation).toMatchObject({ ok: false, issue: 'Esta deuda ya no tiene saldo para reestructurar.' });
    expect(canAdvance('situation', run().view)).toBe(true);
  });
});

describe('condonar mora (DL3)', () => {
  it('is offered only when there is mora to forgive', () => {
    expect(run().view.waivable).toBe(true);
    expect(run({ debt: loan() }).view.waivable).toBe(false);
  });

  it('leaves the mora out of the carried balance and writes waiveLate only when it is set', () => {
    const keep = run();
    const waive = run({ edit: planOf({ waiveLate: true }) });

    expect(waive.view.waive).toBe(true);
    expect(waive.view.carriedMinor).toBe(10190876);
    expect(waive.view.situation.totalMinor).toBe(10192251); // step 1 still shows what the arrears are
    expect(waive.preview().draft).toMatchObject({ kind: 'restructure', effectiveOn: DAY_10, waiveLate: true });
    expect(waive.preview().after.balanceMinor).toBe(10190876);
    expect(keep.preview().draft).not.toHaveProperty('waiveLate');
    expect(keep.preview().after.balanceMinor).toBe(10192251);
  });

  it('ignores a leftover choice when there is no mora', () => {
    const none = run({ debt: loan(), edit: planOf({ waiveLate: true }) });

    expect(none.view.waive).toBe(false);
    expect(none.view.carriedMinor).toBe(10190876);
    expect(none.preview().draft).not.toHaveProperty('waiveLate');
  });
});

describe('step 2: the new conditions', () => {
  it('builds the new terms from the carried balance, the effective date and what was typed, always with its own number of installments', () => {
    const { view, preview } = run({ edit: planOf({ n: '48', rate: { value: '20', basis: 'effective', periodicity: 'annual', timing: 'arrears' }, firstDueOn: '2026-04-15' }) });

    expect(view.plan.ok).toBe(true);
    expect(view.plan.terms).toMatchObject({ principalMinor: 10192251, openedOn: DAY_10, n: 48, firstDueOn: '2026-04-15', rate: { value: 20 }, late: USURY });
    expect(preview().after).toMatchObject({ remainingPeriods: 48, nextDueOn: '2026-04-15' });
    expect(canAdvance('terms', view)).toBe(true);
  });

  it('puts the first installment one period after the effective date while the field is blank', () => {
    const { view } = run();

    expect(view.plan.terms.firstDueOn).toBe('2026-03-15');
  });

  it('shows an inline error and does not advance when the first due date is on or before the effective date', () => {
    for (const firstDueOn of [DAY_10, '2026-02-01']) {
      const { view } = run({ edit: planOf({ firstDueOn }) });

      expect(view.plan.ok).toBe(false);
      expect(view.plan.issues.firstDueOn).toBe('La primera cuota debe ser después de la fecha de la reestructuración.');
      expect(canAdvance('terms', view)).toBe(false);
    }
    expect(canAdvance('terms', run({ edit: planOf({ firstDueOn: '2026-02-16' }) }).view)).toBe(true);
  });

  it('moves the automatic first due date with the effective date, and rejects a blank date', () => {
    expect(run({ edit: planOf({ effectiveOn: '2026-02-10' }) }).view.plan.terms.firstDueOn).toBe('2026-03-10');
    expect(run({ edit: planOf({ firstDueOn: 'not a date' }) }).view.plan.issues.firstDueOn).toBeTruthy();
  });

  it('explains a missing number of installments, a missing rate and a grace as long as the plan', () => {
    expect(run({ edit: planOf({ n: '' }) }).view.plan.issues.n).toBe('Escribe cuántas cuotas tendrá el nuevo plan (entre 1 y 2000).');
    expect(run({ edit: planOf({ n: '2001' }) }).view.plan.issues.n).toBeTruthy();
    expect(run({ edit: planOf({ rate: { value: '', basis: 'effective', periodicity: 'annual', timing: 'arrears' } }) }).view.plan.issues.rate).toBe('Escribe la tasa de interés (0 si no cobra intereses).');
    expect(run({ edit: planOf({ n: '6', grace: { periods: '6', type: 'total' } }) }).view.plan.issues.grace).toBe('Las cuotas de gracia deben ser menos que el número de cuotas.');
    expect(canAdvance('terms', run({ edit: planOf({ n: '' }) }).view)).toBe(false);
  });

  it('keeps the charges editor in charge of its own errors and blocks advancing while a charge is wrong', () => {
    const { form } = run();
    const broken = run({ edit: planOf({ chargeRows: [{ ...form.chargeRows[0], value: 'abc' }] }) });

    expect(broken.view.plan.ok).toBe(false);
    expect(broken.view.plan.issues.charges).toBe('Revisa los cargos señalados.');
    expect(canAdvance('terms', broken.view)).toBe(false);
  });

  it('echoes the rate in EA and carries the usury notice for the effective date', () => {
    const above = run({ edit: planOf({ rate: { value: '40', basis: 'effective', periodicity: 'annual', timing: 'arrears' } }) });
    const below = run();

    expect(above.view.echo.notice).toMatchObject({ code: 'usury_above_cap', capEA: 28.59 });
    expect(below.view.echo).toMatchObject({ ok: true, label: '24% EA' });
    expect(below.view.echo.notice).toBeNull();
  });
});

describe('step 3: the summary and the payload limit', () => {
  it('previews the debt before and after, with the figures the restructure moves', () => {
    const { preview } = run({ edit: planOf({ n: '48', firstDueOn: '2026-04-15' }) });

    const result = preview();
    expect(result.issue).toBeNull();
    expect(result.before).toMatchObject({ balanceMinor: 10000000, pastDueMinor: 391756, lateInterestMinor: 1375 });
    expect(result.after).toMatchObject({ balanceMinor: 10192251, pastDueMinor: 0, lateInterestMinor: 0, remainingPeriods: 48 });
    expect(result.draft.terms.n).toBe(48);
    expect(result.tooLarge).toBe(false);
    expect(result.backdated).toBe(false);
  });

  it('lists the payment whose cost a backdated restructure changes', () => {
    const events = [DISBURSEMENT, makePayment('p1', '2026-02-20', 392000)];
    const { preview } = run({ events, today: '2026-02-25', edit: planOf({ effectiveOn: '2026-02-10' }) });

    const result = preview();
    expect(result.backdated).toBe(true);
    expect(result.impacted.map((entry) => entry.eventId)).toEqual(['p1']);
  });

  it('blocks a payload over 8000 characters with a message, and allows one under it', () => {
    const rows = Array.from({ length: 70 }, (_, index) => ({ id: `c${index}`, kind: 'fee', label: `Cargo número ${index}`, basis: 'fixed', value: '1000', cadence: 'per_installment', fromPeriod: '1', toPeriod: '', refId: '', display: 'itemized' }));
    const big = run({ edit: planOf({ chargeRows: rows }) });
    const small = run();

    const result = big.preview();
    expect(result.payloadChars).toBeGreaterThan(8000);
    expect(result.tooLarge).toBe(true);
    expect(result.issue).toBe(PAYLOAD_TOO_LARGE);
    expect(canAdvance('summary', big.view, result)).toBe(false);
    expect(small.preview().payloadChars).toBeLessThan(8000);
    expect(canAdvance('summary', small.view, small.preview())).toBe(true);
  });

  it('has no preview, and nothing to save, while the plan is wrong', () => {
    const { preview } = run({ edit: planOf({ n: '' }) });

    expect(preview()).toMatchObject({ draft: null, before: null, after: null, tooLarge: false });
  });
});

describe('STEPS', () => {
  it('names the three steps in order', () => {
    expect(STEPS.map((step) => step.title)).toEqual(['Situación actual', 'Nuevas condiciones', 'Resumen']);
  });
});
