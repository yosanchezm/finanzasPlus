// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { previewChange, project, resolveLegal, serializeTerms } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { BACKDATED_NOTE, TOO_LOW_NOTE, chargesInForce, describeChargeChange, findCharge, modesFor, previewChargeChange, previewRateChange, readChargeChange, readPlanChange, rebuildCharges } from './planChange.js';

const TODAY = '2026-10-13';
const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });

// French 10,000,000 at 24% EA, 36 months; the first installment (380,381) fell due on 2026-10-10.
const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debtRow = (terms = loanTerms, extra = {}) => ({ $id: 'd1', householdId: 'h1', name: 'Crédito Vehículo', kind: terms.kind, ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(terms), ...extra });
const event = (id, kind, effectiveOn, amountMinor, payload = {}) => ({ $id: id, debtId: 'd1', householdId: 'h1', kind, effectiveOn, amountMinor, payloadJson: JSON.stringify(payload), actorId: 'telegram:1', source: 'telegram', dedupeKey: `seed:${id}`, $createdAt: `${effectiveOn}T12:00:00.000Z` });
const disbursement = event('e0', 'disbursement', '2026-09-10', 10000000);

const cardTerms = {
  kind: 'card', principalMinor: 500000, openedOn: '2026-04-01', system: 'none', periodicity: 'monthly', rate: { value: 28, basis: 'effective', periodicity: 'annual', timing: 'arrears' },
  card: { statementDay: 15, dueDay: 30, minPayment: { rule: 'interest_fees_plus_pct', pct: 5, floorMinor: 20000 } },
};

const plain = (text) => text.replace(/ /g, ' ');
const run = ({ debt = debtRow(), events = [disbursement], draft = {} } = {}) => previewRateChange({ debt, events, today: TODAY, draft: { effectiveOn: TODAY, rate: EA(22), mode: 'keep_term', ...draft } });

describe('readPlanChange', () => {
  it('defaults the effective date to today and keeps a real date', () => {
    expect(readPlanChange({}, { today: TODAY }).effectiveOn).toBe(TODAY);
    expect(readPlanChange({ effectiveOn: '2026-10-01' }, { today: TODAY }).effectiveOn).toBe('2026-10-01');
    expect(readPlanChange({ effectiveOn: 'ayer' }, { today: TODAY }).effectiveOn).toBe(TODAY);
    expect(readPlanChange({ effectiveOn: '2026-02-30' }, { today: TODAY }).effectiveOn).toBe(TODAY);
  });

  it('keeps only the two known modes', () => {
    expect(readPlanChange({ mode: 'keep_installment' }, { today: TODAY }).mode).toBe('keep_installment');
    expect(readPlanChange({ mode: 'keep_term' }, { today: TODAY }).mode).toBe('keep_term');
    expect(readPlanChange({ mode: 'shorten' }, { today: TODAY }).mode).toBeNull();
    expect(readPlanChange(null, { today: TODAY })).toMatchObject({ effectiveOn: TODAY, mode: null });
  });
});

describe('modesFor', () => {
  const modes = (debt, events = [disbursement]) => modesFor(project(debt, events, TODAY));

  it('offers keep_installment only to French loans, and nothing to a card', () => {
    expect(modes(debtRow())).toEqual(['keep_term', 'keep_installment']);
    expect(modes(debtRow({ ...loanTerms, system: 'german' }))).toEqual(['keep_term']);
    expect(modes(debtRow(cardTerms, { kind: 'card' }), [])).toEqual([]);
  });
});

describe('previewRateChange', () => {
  it('previews a lower rate with the EA echo, the new installment and the cost change, keeping the term', () => {
    const debt = debtRow();
    const result = run({ debt, draft: { mode: 'keep_term' } });
    const expected = previewChange(debt, [disbursement].map((row) => ({ ...row })), { kind: 'rate_change', effectiveOn: TODAY, rate: EA(22), mode: 'keep_term' }, { on: TODAY });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('keep_term');
    expect(result.draft).toEqual({ effectiveOn: TODAY, rate: EA(22), mode: 'keep_term' });
    const text = plain(result.text);
    expect(text).toContain('Cambio de tasa en Crédito Vehículo');
    expect(text).toContain('Nueva tasa: 22% EA');
    expect(text).toContain(`Cuota: ${pesos(expected.before.installmentMinor)} → ${pesos(expected.after.installmentMinor)}`);
    expect(text).toContain(`Cuotas restantes: ${expected.before.remainingPeriods} → ${expected.after.remainingPeriods}`);
    expect(text).toContain(`Intereses por pagar: ${pesos(expected.before.remainingInterestMinor)} → ${pesos(expected.after.remainingInterestMinor)}`);
    expect(expected.after.installmentMinor).toBeLessThan(expected.before.installmentMinor);
    expect(text).toContain('Se mantiene el plazo');
    expect(text).toContain('Aún no se guarda');
  });

  it('echoes the EA equivalent of a non-annual rate', () => {
    const result = run({ draft: { rate: { value: 2, basis: 'effective', periodicity: 'monthly', timing: 'arrears' } } });

    expect(plain(result.text)).toContain('Nueva tasa: 2% MV ≈ 26.82% EA');
  });

  it('asks for the mode (without computing a preview) when a French loan has none yet, and not for any other debt', () => {
    const french = run({ draft: { mode: null } });
    const german = run({ debt: debtRow({ ...loanTerms, system: 'german' }), draft: { mode: null } });

    expect(french).toMatchObject({ ok: true, needsMode: true, modes: ['keep_term', 'keep_installment'] });
    expect(plain(french.text)).toContain('mantener el plazo');
    expect(plain(french.text)).toContain('mantener la cuota');
    expect(plain(french.text)).toContain('22% EA');
    expect(german.needsMode).toBeUndefined();
    expect(german.mode).toBe('keep_term');
  });

  it('keeps the installment and changes the number of installments for keep_installment', () => {
    const debt = debtRow();
    const result = run({ debt, draft: { mode: 'keep_installment' } });
    const expected = previewChange(debt, [disbursement], { kind: 'rate_change', effectiveOn: TODAY, rate: EA(22), mode: 'keep_installment' }, { on: TODAY });

    expect(result.mode).toBe('keep_installment');
    expect(expected.after.installmentMinor).toBe(expected.before.installmentMinor);
    expect(expected.after.remainingPeriods).toBeLessThan(expected.before.remainingPeriods);
    expect(plain(result.text)).toContain('Se mantiene la cuota');
    expect(plain(result.text)).toContain(`Cuotas restantes: ${expected.before.remainingPeriods} → ${expected.after.remainingPeriods}`);
  });

  it('cites the household usury cap (29.00) and still previews a 30% EA rate', () => {
    const legal = resolveLegal([{ kind: 'usury', modality: 'consumer', validFrom: '2026-10-01', validTo: '2026-10-31', value: 2900, source: 'Resolución', verified: true }]);
    const result = run({ debt: debtRow(loanTerms, { legal }), draft: { rate: EA(30) } });

    expect(result.ok).toBe(true);
    expect(plain(result.text)).toContain('supera el tope de usura de 29% E.A.');
    expect(plain(result.text)).toContain('30.00% E.A.');
    expect(plain(result.text)).toContain('no bloquea');
  });

  it('adds no usury notice below the cap and says when the household tables could not be read', () => {
    expect(plain(run().text)).not.toContain('usura');

    const unavailable = run({ debt: debtRow(loanTerms, { legal: resolveLegal.unavailable() }), draft: { rate: EA(30) } });
    expect(plain(unavailable.text)).toContain('28.59% E.A.');
    expect(plain(unavailable.text)).toContain('No pude leer las tasas legales del hogar');
  });

  it('explains installment_too_low and falls back to keep_term when keep_installment cannot work', () => {
    const result = run({ draft: { rate: EA(700), mode: 'keep_installment' } });

    expect(result.ok).toBe(true);
    expect(result.tooLow).toBe(true);
    expect(result.mode).toBe('keep_term');
    expect(result.draft.mode).toBe('keep_term');
    expect(plain(result.text)).toContain(TOO_LOW_NOTE);
    expect(plain(result.text)).toContain('mantener el plazo');
  });

  it('downgrades keep_installment to keep_term for a system that has no fixed installment, saying so', () => {
    const result = run({ debt: debtRow({ ...loanTerms, system: 'german' }), draft: { mode: 'keep_installment' } });

    expect(result.mode).toBe('keep_term');
    expect(result.draft.mode).toBe('keep_term');
    expect(plain(result.text)).toContain('Este sistema mantiene el plazo');
  });

  it('skips the mode for a card and compares its next minimum payment', () => {
    const card = debtRow(cardTerms, { kind: 'card', name: 'Visa' });
    const result = run({ debt: card, events: [], draft: { rate: EA(35), mode: 'keep_installment' } });

    expect(result.ok).toBe(true);
    expect(result.draft.mode).toBe('keep_term');
    const text = plain(result.text);
    expect(text).toContain('Cambio de tasa en Visa');
    expect(text).toContain('Próximo pago mínimo');
    expect(text).not.toContain('Se mantiene');
    expect(text).not.toContain('Cuotas restantes');
  });

  it('adds the backdated note only when a recorded payment changes cost', () => {
    const payment = event('p1', 'payment', '2026-10-10', 380381);
    const past = run({ events: [disbursement, payment], draft: { effectiveOn: '2026-09-10' } });
    const future = run({ events: [disbursement, payment], draft: { effectiveOn: '2026-11-01' } });
    const today = run({ events: [disbursement], draft: { effectiveOn: TODAY } });

    expect(plain(past.text)).toContain(BACKDATED_NOTE);
    expect(plain(future.text)).not.toContain(BACKDATED_NOTE);
    expect(plain(today.text)).not.toContain(BACKDATED_NOTE);
    expect(BACKDATED_NOTE).toBe('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
  });

  it('reports an unreadable debt or a rate the core refuses in Spanish instead of throwing', () => {
    const broken = run({ debt: debtRow(loanTerms, { termsJson: '{' }) });

    expect(broken).toMatchObject({ ok: false });
    expect(broken.issue).toContain('No pude leer los términos');
    expect(run({ draft: { rate: EA(-5) } })).toMatchObject({ ok: false, issue: expect.stringContaining('No pude calcular') });
  });

  it('is read-only: the events and the debt are not touched', () => {
    const events = [disbursement];
    const before = JSON.stringify(events);
    run({ events });

    expect(JSON.stringify(events)).toBe(before);
  });
});

// ---- charge change (E2c) ----

const CHARGES = [
  { id: 'life', kind: 'insurance', label: 'Seguro de vida', basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' },
  { id: 'fee', kind: 'fee', label: 'Cuota de manejo', basis: 'fixed', value: 10000, cadence: 'per_installment' },
  { id: 'iva', kind: 'tax', label: 'IVA', basis: 'pctOfCharge', refId: 'fee', value: 19, cadence: 'per_installment' },
];
const chargedLoan = () => debtRow({ ...loanTerms, charges: CHARGES });
const projectionOf = (debt, events = [disbursement]) => project(debt, events, TODAY);
const runCharge = ({ debt = chargedLoan(), events = [disbursement], draft = {} } = {}) => previewChargeChange({ debt, events, today: TODAY, draft: { effectiveOn: TODAY, op: 'set', chargeRef: 'seguro de vida', newValue: 0.1, ...draft } });

describe('readChargeChange', () => {
  const read = (raw) => readChargeChange(raw, { today: TODAY });

  it('reads a change of value, a removal and an addition, with the date defaulting to today', () => {
    expect(read({ chargeRef: ' seguro de vida ', op: 'set', newValue: 0.1 })).toEqual({ effectiveOn: TODAY, chargeRef: 'seguro de vida', op: 'set', newValue: 0.1, missing: [], problems: [] });
    expect(read({ chargeRef: 'seguro', op: 'remove', effectiveOn: '2026-11-01' })).toMatchObject({ effectiveOn: '2026-11-01', op: 'remove', newValue: null, missing: [] });
    expect(read({ chargeRef: null, op: 'add', newValue: 50000 })).toMatchObject({ op: 'add', missing: [] });
  });

  it('infers a change of value when only a value came, and asks for what is missing', () => {
    expect(read({ chargeRef: 'manejo', newValue: 12000 })).toMatchObject({ op: 'set', newValue: 12000, missing: [] });
    expect(read({ chargeRef: 'manejo' }).missing).toEqual(['charge_action']);
    expect(read({ op: 'remove' }).missing).toEqual(['charge']);
    expect(read({ chargeRef: 'manejo', op: 'set' }).missing).toEqual(['charge_value']);
    expect(read(null).missing).toEqual(['charge', 'charge_action']);
  });

  it('refuses a negative value and drops unknown operations', () => {
    expect(read({ chargeRef: 'manejo', op: 'set', newValue: -5 })).toMatchObject({ problems: ['invalid_amount'], missing: [] });
    expect(read({ chargeRef: 'manejo', op: 'delete' }).op).toBeNull();
  });
});

describe('chargesInForce', () => {
  it('is the charges of the terms for a loan', () => {
    const debt = chargedLoan();

    expect(chargesInForce(projectionOf(debt), [disbursement], TODAY).map((charge) => charge.id)).toEqual(['life', 'fee', 'iva']);
  });

  it('folds the active charge_change events up to today for a card, ignoring voided and future ones', () => {
    const card = debtRow({ ...cardTerms, charges: CHARGES }, { kind: 'card' });
    const change = (id, effectiveOn, ids) => event(id, 'charge_change', effectiveOn, 0, { charges: CHARGES.filter((charge) => ids.includes(charge.id)) });
    const events = [change('c1', '2026-08-01', ['life', 'fee', 'iva']), change('c2', '2026-09-01', ['fee', 'iva']), change('c3', '2026-12-01', ['life'])];
    const ids = (list) => chargesInForce(project(card, list, TODAY), list, TODAY).map((charge) => charge.id);

    expect(ids(events)).toEqual(['fee', 'iva']);
    expect(ids([...events, event('v1', 'void', '2026-09-15', 0, { targetEventId: 'c2' })])).toEqual(['life', 'fee', 'iva']);
    expect(ids([])).toEqual(['life', 'fee', 'iva']);
  });
});

describe('findCharge', () => {
  it('matches by label ignoring case and accents, then by words of the label, then by kind', () => {
    expect(findCharge(CHARGES, 'SEGURO DE VIDA')).toEqual({ match: CHARGES[0] });
    expect(findCharge(CHARGES, 'cuota de manejó')).toEqual({ match: CHARGES[1] });
    expect(findCharge(CHARGES, 'manejo')).toEqual({ match: CHARGES[1] });
    expect(findCharge(CHARGES, 'el seguro')).toEqual({ match: CHARGES[0] });
    expect(findCharge(CHARGES, 'impuesto')).toEqual({ match: CHARGES[2] });
  });

  it('returns the candidates when several match and none when nothing does', () => {
    const two = [...CHARGES, { id: 'life2', kind: 'insurance', label: 'Seguro todo riesgo', basis: 'fixed', value: 5000, cadence: 'per_installment' }];

    expect(findCharge(two, 'seguro')).toEqual({ candidates: [two[0], two[3]] });
    expect(findCharge(CHARGES, 'gps')).toEqual({ none: true });
    expect(findCharge(CHARGES, '')).toEqual({ none: true });
  });
});

describe('previewChargeChange', () => {
  it('previews the removal of an insurance with the next installment before and after, and writes nothing', () => {
    const debt = chargedLoan();
    const result = runCharge({ debt, draft: { op: 'remove', newValue: null } });
    const expected = previewChange(debt, [disbursement], { kind: 'charge_change', effectiveOn: TODAY, charges: CHARGES.filter((charge) => charge.id !== 'life') }, { on: TODAY });

    expect(result.ok).toBe(true);
    expect(result.draft).toEqual({ effectiveOn: TODAY, chargeId: 'life', op: 'remove', newValue: null });
    const text = plain(result.text);
    expect(text).toContain('Cambio de cargos en Crédito Vehículo');
    expect(text).toContain('Se quita: Seguro de vida');
    expect(text).toContain(`Próxima cuota (con cargos): ${pesos(expected.before.nextTotalMinor)} → ${pesos(expected.after.nextTotalMinor)}`);
    expect(text).toContain(`Cargos por pagar: ${pesos(expected.before.remainingChargesMinor)} → ${pesos(expected.after.remainingChargesMinor)}`);
    expect(expected.after.nextTotalMinor).toBeLessThan(expected.before.nextTotalMinor);
    expect(text).toContain('Aún no se guarda');
  });

  it('previews a new value for a charge', () => {
    const result = runCharge({ draft: { chargeRef: 'cuota de manejo', op: 'set', newValue: 15000 } });

    expect(result.ok).toBe(true);
    expect(result.draft).toMatchObject({ chargeId: 'fee', op: 'set', newValue: 15000 });
    expect(plain(result.text)).toContain(`Cuota de manejo: ${pesos(10000)} → ${pesos(15000)}`);
  });

  it('lists the charges that go with a removed one (IVA depends on the fee)', () => {
    const result = runCharge({ draft: { chargeRef: 'cuota de manejo', op: 'remove', newValue: null } });

    expect(plain(result.text)).toContain('Se quita: Cuota de manejo');
    expect(plain(result.text)).toContain('También se quita lo que depende de él: IVA');
  });

  it('asks which charge when several match, and answers when none does or the debt has no charges', () => {
    const two = debtRow({ ...loanTerms, charges: [...CHARGES, { id: 'life2', kind: 'insurance', label: 'Seguro todo riesgo', basis: 'fixed', value: 5000, cadence: 'per_installment' }] });
    const several = runCharge({ debt: two, draft: { chargeRef: 'seguro' } });
    const none = runCharge({ draft: { chargeRef: 'gps' } });
    const empty = runCharge({ debt: debtRow(), draft: { chargeRef: 'seguro' } });

    expect(several).toMatchObject({ ok: true, needsCharge: true });
    expect(several.candidates.map((charge) => charge.id)).toEqual(['life', 'life2']);
    expect(none).toMatchObject({ ok: false });
    expect(plain(none.issue)).toContain('No encontré');
    expect(plain(none.issue)).toContain('Seguro de vida');
    expect(plain(empty.issue)).toContain('no tiene seguros ni cargos');
  });

  it('uses the chosen charge id instead of the words', () => {
    const result = runCharge({ draft: { chargeRef: 'seguro', chargeId: 'fee', op: 'set', newValue: 12000 } });

    expect(result.draft).toMatchObject({ chargeId: 'fee' });
  });

  it('says there is nothing to change when the value is the same', () => {
    expect(runCharge({ draft: { newValue: 0.05 } })).toMatchObject({ ok: false, issue: expect.stringContaining('ya tiene ese valor') });
  });

  it('refuses values that the charge cannot take', () => {
    expect(runCharge({ draft: { chargeRef: 'manejo', newValue: 12000.5 } }).issue).toContain('pesos enteros');
    expect(runCharge({ draft: { newValue: 150 } }).issue).toContain('100');
  });

  it('adds the backdated note when a recorded payment changes cost, and not otherwise', () => {
    const payment = event('p1', 'payment', '2026-10-10', 390381);
    const past = runCharge({ events: [disbursement, payment], draft: { effectiveOn: '2026-09-10', op: 'remove', newValue: null } });
    const now = runCharge({ events: [disbursement, payment], draft: { op: 'remove', newValue: null } });

    expect(plain(past.text)).toContain(BACKDATED_NOTE);
    expect(plain(now.text)).not.toContain(BACKDATED_NOTE);
  });

  it('works on a card: next minimum payment, charges folded from the stored changes', () => {
    const card = debtRow({ ...cardTerms, charges: CHARGES }, { kind: 'card', name: 'Visa' });
    const result = runCharge({ debt: card, events: [], draft: { chargeRef: 'cuota de manejo', op: 'set', newValue: 20000 } });

    expect(result.ok).toBe(true);
    expect(plain(result.text)).toContain('Cambio de cargos en Visa');
    expect(plain(result.text)).toContain('Próximo pago mínimo');
  });

  it('reports an unreadable debt in Spanish', () => {
    expect(runCharge({ debt: debtRow(loanTerms, { termsJson: '{' }) })).toMatchObject({ ok: false, issue: expect.stringContaining('No pude leer los términos') });
  });
});

describe('rebuildCharges (Confirm)', () => {
  it('rebuilds the whole charge set from the live debt: the stored draft only names the charge and the change', () => {
    const debt = chargedLoan();
    const projection = projectionOf(debt);

    expect(rebuildCharges(chargesInForce(projection, [disbursement], TODAY), { chargeId: 'fee', op: 'set', newValue: 12000 }).charges.map((charge) => [charge.id, charge.value]))
      .toEqual([['life', 0.05], ['fee', 12000], ['iva', 19]]);
    expect(rebuildCharges(CHARGES, { chargeId: 'fee', op: 'remove' }).charges.map((charge) => charge.id)).toEqual(['life']);
  });

  it('fails when the charge is no longer there', () => {
    expect(rebuildCharges(CHARGES.slice(1), { chargeId: 'life', op: 'remove' })).toMatchObject({ gone: true });
  });
});

describe('describeChargeChange', () => {
  it('reports what was written with the next installment before and after', () => {
    const debt = chargedLoan();
    const draft = { effectiveOn: TODAY, chargeId: 'life', op: 'remove', newValue: null };
    const figures = previewChange(debt, [disbursement], { kind: 'charge_change', effectiveOn: TODAY, charges: CHARGES.slice(1) }, { on: TODAY });
    const text = plain(describeChargeChange(debt, CHARGES[0], draft, figures));

    expect(text).toContain('registré el cambio de cargos de Crédito Vehículo');
    expect(text).toContain('quité Seguro de vida');
    expect(text).toContain(`Próxima cuota (con cargos): ${pesos(figures.before.nextTotalMinor)} → ${pesos(figures.after.nextTotalMinor)}`);
  });
});
