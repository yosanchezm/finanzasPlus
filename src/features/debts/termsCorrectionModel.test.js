import { buildCorrection, planCommit, project } from '@finance-core';
import { describe, expect, it } from 'vitest';
import { makeCard, makeDebt, makeEvent, makeMoraCard } from './debtFixtures';
import { RETROACTIVE_NOTE, describeCorrection, initialCorrectionForm, previewCorrection } from './termsCorrectionModel';

const TODAY = '2026-06-01';
const EA = (value) => ({ value: String(value), basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const NAMV = (value) => ({ value: String(value), basis: 'nominal', periodicity: 'monthly', timing: 'arrears' });
const correctionEvent = (id, on, fields, previous, appliesTo = 'opening') => makeEvent(id, 'terms_correction', on, 0, { fields, previous, appliesTo });

// Runs the preview the way the dialog does: the stored terms prefill the form, and the test changes only what it names.
function run({ debt = makeDebt(), events = [], change = {}, cardChange = {} } = {}) {
  const base = initialCorrectionForm(debt, events, TODAY);
  const form = { ...base, ...change, card: base.card ? { ...base.card, ...cardChange } : null };
  return previewCorrection({ debt, events, form, today: TODAY });
}

describe('initialCorrectionForm', () => {
  it('prefills a loan with the stored rate as the strings the inputs hold and its modality, and no card fields', () => {
    const form = initialCorrectionForm(makeDebt(), [], TODAY);
    expect(form).toEqual({ rate: EA(24), modality: 'consumer', card: null });
  });

  it('prefills a card with its day, due day and minimum rule, and offers nothing that is not supported', () => {
    const form = initialCorrectionForm(makeCard(), [], TODAY);
    expect(form).toEqual({
      rate: EA(28),
      modality: 'consumer',
      card: { statementDay: '15', dueDay: '30', minRule: 'interest_fees_plus_pct', minPct: '5', minFloor: '20000' },
    });
    expect(Object.keys(form).sort()).toEqual(['card', 'modality', 'rate']);
    expect(Object.keys(form.card).sort()).toEqual(['dueDay', 'minFloor', 'minPct', 'minRule', 'statementDay']);
  });

  it('keeps the convention the rate was stated in', () => {
    const debt = makeDebt({}, { rate: { value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' } });
    expect(initialCorrectionForm(debt, [], TODAY).rate).toEqual(NAMV(25.2));
  });

  it('starts from the terms version and the corrections already recorded, not from a later rate change', () => {
    const rateChange = makeEvent('r1', 'rate_change', '2026-03-01', 0, { rate: { value: 20, basis: 'effective', periodicity: 'annual', timing: 'arrears' }, mode: 'keep_term' });
    expect(initialCorrectionForm(makeDebt(), [rateChange], TODAY).rate).toEqual(EA(24));
    const fixed = correctionEvent('c1', '2026-04-01', { rate: { value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' } }, { rate: { value: 24, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
    expect(initialCorrectionForm(makeDebt(), [rateChange, fixed], TODAY).rate).toEqual(NAMV(25.2));
    const day = correctionEvent('c2', '2026-04-01', { card: { statementDay: 20 } }, { card: { statementDay: 15 } });
    expect(initialCorrectionForm(makeCard(), [day], TODAY).card.statementDay).toBe('20');
  });
});

describe('previewCorrection: validity', () => {
  it('disables saving with an inline message when nothing changed', () => {
    const result = run();
    expect(result.draft).toBeNull();
    expect(result.noChange).toBe(true);
    expect(result.issue).toBe('Los datos son iguales a los guardados. Cambia al menos uno para guardar.');
    expect(run({ debt: makeCard() }).noChange).toBe(true);
  });

  it('explains an empty or out-of-range value and builds no draft', () => {
    expect(run({ debt: makeCard(), cardChange: { statementDay: '' } })).toMatchObject({ draft: null, noChange: false, issue: 'Escribe el día de corte.' });
    expect(run({ debt: makeCard(), cardChange: { dueDay: '' } }).issue).toBe('Escribe el día límite de pago.');
    expect(run({ debt: makeCard(), cardChange: { statementDay: '0' } })).toMatchObject({ draft: null, issue: 'Los días de corte y de pago van del 1 al 31.' });
    expect(run({ debt: makeCard(), cardChange: { dueDay: '32' } }).draft).toBeNull();
    expect(run({ debt: makeCard(), cardChange: { statementDay: '10.5' } }).issue).toBe('Los días de corte y de pago van del 1 al 31.');
    expect(run({ debt: makeCard(), cardChange: { minPct: '150' } })).toMatchObject({ draft: null, issue: 'El porcentaje del pago mínimo va de 0 a 100.' });
    expect(run({ change: { rate: EA('') } })).toMatchObject({ draft: null, issue: 'Escribe la tasa.' });
    expect(run({ change: { rate: EA('-3') } }).draft).toBeNull();
  });

  it('never offers card fields for a loan, even if the form carries them', () => {
    const debt = makeDebt();
    const form = { ...initialCorrectionForm(debt, [], TODAY), rate: NAMV(25.2), card: { statementDay: '20', dueDay: '25', minRule: 'pct_balance', minPct: '3', minFloor: '0' } };
    const result = previewCorrection({ debt, events: [], form, today: TODAY });
    expect(Object.keys(result.draft.fields)).toEqual(['rate']);
  });
});

describe('previewCorrection: the draft and the preview', () => {
  it('builds the draft through buildCorrection: a card day 15 to 20 with the previous value', () => {
    const debt = makeCard();
    const result = run({ debt, cardChange: { statementDay: '20' } });
    expect(result.draft).toEqual(buildCorrection(debt, [], { card: { statementDay: 20 } }, { on: TODAY }));
    expect(result.draft).toMatchObject({ kind: 'terms_correction', fields: { card: { statementDay: 20 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening' });
    expect(result.rows[0]).toEqual({ label: 'Día de corte', before: '15', after: '20' });
    expect(result.noChange).toBe(false);
    expect(result.issue).toBeNull();
  });

  it('keeps only what changed even when the form carries every field', () => {
    const result = run({ debt: makeCard(), cardChange: { dueDay: '25', minPct: '3' } });
    expect(result.draft.fields).toEqual({ card: { dueDay: 25, minPayment: { pct: 3 } } });
    expect(result.rows.slice(0, 2)).toEqual([
      { label: 'Día de pago', before: '30', after: '25' },
      { label: 'Pago mínimo', before: '5 %', after: '3 %' },
    ]);
  });

  it('echoes the rate: 25,2 % N.M.V. on a debt saved as 24 % E.A. is about 28,32 % E.A., stated with its convention', () => {
    const debt = makeDebt({}, { rate: { value: 28.32, basis: 'effective', periodicity: 'annual', timing: 'arrears' } });
    const result = run({ debt, change: { rate: NAMV('25.2') } });
    expect(result.echo.ok).toBe(true);
    expect(result.echo.eaPercent).toBeCloseTo(28.32, 1);
    expect(result.draft.fields.rate).toEqual({ value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' });
    expect(result.rows[0]).toEqual({ label: 'Tasa', before: '28,32 % E.A.', after: '25,2 % N.M.V.' });
    expect(result.after.installmentMinor).not.toBe(result.before.installmentMinor);
  });

  it('corrects the modality', () => {
    const result = run({ change: { modality: 'mortgage' } });
    expect(result.draft.fields).toEqual({ modality: 'mortgage' });
    expect(result.rows[0]).toEqual({ label: 'Modalidad', before: 'Consumo', after: 'Hipotecario' });
  });

  it('states that the correction applies from the start of the debt and that a real change uses Cambiar tasa', () => {
    expect(RETROACTIVE_NOTE).toMatch(/desde el inicio de la deuda/);
    expect(RETROACTIVE_NOTE).toMatch(/«Cambiar tasa»/);
  });

  it('lists the past payments whose cost changes, as the other dialogs do', () => {
    const debt = makeMoraCard();
    const payment = makeEvent('p1', 'payment', '2026-05-20', 140000);
    const result = run({ debt, events: [payment], cardChange: { minPct: '3' } });
    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0]).toMatchObject({ eventId: 'p1', label: 'Pago del 20 may' });
    expect(result.impacted[0].costBeforeMinor).not.toBe(result.impacted[0].costAfterMinor);
    expect(run({ debt: makeMoraCard(), cardChange: { dueDay: '25' } }).impacted).toEqual([]);
  });

  it('shows what the debt looks like after, equal to the projection once the event is saved', () => {
    const debt = makeCard();
    const result = run({ debt, cardChange: { statementDay: '20', minPct: '3' } });
    const plan = planCommit(debt, [], result.draft, { eventId: 'x1', dedupeKey: 'web:x', actorId: 'u1', source: 'web', asOf: TODAY });
    const saved = project(debt, [{ ...makeEvent('x1', 'terms_correction', TODAY, 0, JSON.parse(plan.event.data.payloadJson)) }], TODAY);
    expect(plan.projection.card).toEqual(saved.card);
    expect(result.after.balanceMinor).toBe(saved.balanceMinor);
  });

  it('warns about the statements already recorded when the cut or due day changes, and only then', () => {
    const debt = makeCard();
    const statements = [
      makeEvent('a1', 'adjustment', '2026-04-15', 0, { balanceMinor: 1621102 }),
      makeEvent('a2', 'adjustment', '2026-05-15', 0, { balanceMinor: 1000000 }),
    ];
    expect(run({ debt, events: statements, cardChange: { statementDay: '20' } }).warning).toBe('Tienes 2 extractos registrados; revisa que coincidan.');
    expect(run({ debt, events: statements.slice(0, 1), cardChange: { dueDay: '25' } }).warning).toBe('Tienes 1 extracto registrado; revisa que coincida.');
    expect(run({ debt, events: statements, cardChange: { minPct: '3' } }).warning).toBeNull();
    expect(run({ debt, events: [], cardChange: { statementDay: '20' } }).warning).toBeNull();
  });
});

describe('describeCorrection', () => {
  it('lists each changed field with its old and new value, in a fixed order', () => {
    const lines = describeCorrection(
      { card: { statementDay: 20, minPayment: { pct: 3, floorMinor: 10000 } }, rate: { value: 25.2, basis: 'nominal', periodicity: 'monthly', timing: 'arrears' } },
      { card: { statementDay: 15, minPayment: { pct: 5, floorMinor: 20000 } }, rate: { value: 28.32, basis: 'effective', periodicity: 'annual', timing: 'arrears' } },
    );
    expect(lines).toEqual([
      { key: 'rate', label: 'Tasa', before: '28,32 % E.A.', after: '25,2 % N.M.V.' },
      { key: 'statementDay', label: 'Día de corte', before: '15', after: '20' },
      { key: 'minPct', label: 'Pago mínimo', before: '5 %', after: '3 %' },
      { key: 'minFloor', label: 'Piso del pago mínimo', before: '$ 20.000', after: '$ 10.000' },
    ]);
  });

  it('names the rule in words and survives a missing previous value', () => {
    const lines = describeCorrection({ card: { minPayment: { rule: 'pct_balance' } }, modality: 'productive' }, { card: { minPayment: { rule: 'interest_fees_plus_pct' } } });
    expect(lines.map((line) => [line.key, line.before, line.after])).toEqual([
      ['modality', null, 'Productivo'],
      ['minRule', 'Intereses y cuotas más un porcentaje', 'Un porcentaje del extracto'],
    ]);
  });
});
