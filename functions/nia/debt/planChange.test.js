// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addExplicitCharge, addPresetCharge, buildRestructureTerms, previewChange, project, resolveLegal, restructureCarry, serializeTerms } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { PENDING_MAX_BYTES, buildPending } from './pending.js';
import { BACKDATED_NOTE, TOO_LOW_NOTE, chargesInForce, describeChargeAdd, describeChargeChange, describeRestructure, findCharge, modesFor, previewChargeChange, previewRateChange, previewRestructure, readChargeChange, readPlanChange, readRestructure, rebuildCharges, rebuildRestructure, restructureDraft } from './planChange.js';

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
    expect(read({ chargeRef: null, op: 'add', label: 'Seguro', basis: 'fixed', newValue: 50000 })).toMatchObject({ op: 'add', missing: [] });
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

// ---- charge add (S6a, NA8) ----

const LIFE_12K = { kind: 'insurance', label: 'Seguro de vida', basis: 'fixed', value: 12000, cadence: 'per_installment' };
const cardRow = () => debtRow(cardTerms, { kind: 'card', name: 'Visa' });
const runAdd = ({ debt = chargedLoan(), events = [disbursement], add, effectiveOn = TODAY } = {}) => previewChargeChange({ debt, events, today: TODAY, draft: { effectiveOn, op: 'add', add } });

describe('readChargeChange: add', () => {
  const read = (raw, presets = {}) => readChargeChange(raw, { today: TODAY, presets });

  it('keeps the presets the user mentioned, or the explicit fields, in an add block', () => {
    expect(read({ op: 'add' }, { fee: 45000, iva: 19 })).toMatchObject({ op: 'add', missing: [], problems: [], add: { presets: { fee: 45000, iva: 19 }, charge: null } });
    expect(read({ op: 'add', kind: 'insurance', label: ' Seguro de vida ', basis: 'fixed', newValue: 12000 })).toMatchObject({ op: 'add', missing: [], add: { presets: {}, charge: LIFE_12K } });
    expect(read({ op: 'add', kind: 'tax', label: 'Impuesto', basis: 'pctOfCharge', newValue: 10, cadence: 'annual', refLabel: 'cuota de manejo' }).add.charge)
      .toEqual({ kind: 'tax', label: 'Impuesto', basis: 'pctOfCharge', value: 10, cadence: 'annual', refLabel: 'cuota de manejo' });
  });

  it('defaults an unknown kind to other and an unknown cadence to per_installment', () => {
    expect(read({ op: 'add', kind: 'raro', label: 'Cargo X', basis: 'fixed', newValue: 500, cadence: 'weekly' }).add.charge).toEqual({ kind: 'other', label: 'Cargo X', basis: 'fixed', value: 500, cadence: 'per_installment' });
  });

  it('asks which charge it is and for the amounts that were not given', () => {
    expect(read({ op: 'add', newValue: 50000 }).missing).toEqual(['charge_spec']);
    expect(read({ op: 'add', label: 'Seguro', basis: 'fixed' }).missing).toEqual(['charge_value']);
    expect(read({ op: 'add' }, { life: null }).missing).toEqual(['charge_value']);
    expect(read({ op: 'add' }, { gmf: true }).missing).toEqual([]);
  });

  it('refuses a negative explicit value and leaves edit and remove without an add block', () => {
    expect(read({ op: 'add', label: 'Seguro', basis: 'fixed', newValue: -1 })).toMatchObject({ problems: ['invalid_amount'], missing: [] });
    expect(read({ op: 'remove', chargeRef: 'manejo' }).add).toBeUndefined();
  });
});

describe('previewChargeChange: add', () => {
  it('previews a life insurance of 12,000 a month on a card from the effective date', () => {
    const debt = debtRow({ ...cardTerms, openedOn: '2026-09-01', card: { ...cardTerms.card, statementDay: 10, dueDay: 25 } }, { kind: 'card', name: 'Visa' });
    const add = { presets: {}, charge: LIFE_12K };
    const result = runAdd({ debt, events: [], add, effectiveOn: '2026-09-01' });
    const expected = previewChange(debt, [], { kind: 'charge_change', effectiveOn: '2026-09-01', charges: addExplicitCharge([], LIFE_12K) }, { on: TODAY });
    const text = plain(result.text);

    expect(result.ok).toBe(true);
    expect(result.draft).toEqual({ effectiveOn: '2026-09-01', op: 'add', add });
    expect(text).toContain('Cambio de cargos en Visa');
    expect(text).toContain('Desde: 2026-09-01');
    expect(text).toContain(`Se agrega: Seguro de vida: ${pesos(12000)}`);
    expect(text).toContain(`Próximo pago mínimo: ${pesos(expected.before.nextTotalMinor)} → ${pesos(expected.after.nextTotalMinor)}`);
    expect(expected.after.nextTotalMinor).toBeGreaterThan(expected.before.nextTotalMinor);
    expect(text).toContain('Aún no se guarda');
  });

  it('previews a fee of 45,000 with its IVA preset: IVA 8,550 linked to the fee', () => {
    const loan = runAdd({ debt: debtRow(), add: { presets: { fee: 45000, iva: 19 }, charge: null } });
    const card = runAdd({ debt: cardRow(), events: [], add: { presets: { fee: 45000, iva: 19 }, charge: null } });

    expect(plain(loan.text)).toContain(`Comisión o cuota de manejo: ${pesos(45000)}`);
    expect(plain(loan.text)).toContain(`IVA sobre la comisión: ${pesos(8550)}`);
    expect(plain(card.text)).toContain(`Cuota de manejo: ${pesos(45000)}`);
    expect(plain(card.text)).toContain(`IVA: ${pesos(8550)}`);
    expect(plain(card.text)).toContain('Se agregan:');
  });

  it('adds an IVA preset to the single fee the debt already has, whatever its id', () => {
    const debt = debtRow({ ...loanTerms, charges: [{ id: 'cuota', kind: 'fee', label: 'Admin', basis: 'fixed', value: 20000, cadence: 'per_installment' }] });
    const result = runAdd({ debt, add: { presets: { iva: 19 }, charge: null } });

    expect(plain(result.text)).toContain(`IVA sobre la comisión: ${pesos(3800)}`);
  });

  it('validates the added charge against the resulting set and says what is wrong in Spanish', () => {
    const exists = runAdd({ add: { presets: { fee: 5000 }, charge: null } });
    const noFee = runAdd({ debt: debtRow(), add: { presets: { iva: 19 }, charge: null } });
    const dangling = runAdd({ add: { presets: {}, charge: { kind: 'tax', label: 'Extra', basis: 'pctOfCharge', value: 10, cadence: 'per_installment', refLabel: 'no existe' } } });
    const fractional = runAdd({ add: { presets: {}, charge: { ...LIFE_12K, value: 12000.5 } } });

    expect(exists).toMatchObject({ ok: false, issue: expect.stringContaining('ya existe') });
    expect(noFee.issue).toContain('cuota de manejo');
    expect(dangling.issue).toContain('no existe');
    expect(fractional.issue).toContain('pesos enteros');
    for (const result of [exists, noFee, dangling, fractional]) expect(result.issue).not.toContain('usa la web');
  });

  it('adds the backdated note when the new charge starts before a recorded payment, and not otherwise', () => {
    const payment = event('p1', 'payment', '2026-10-10', 390381);
    const add = { presets: {}, charge: LIFE_12K };
    const past = runAdd({ debt: debtRow(), events: [disbursement, payment], effectiveOn: '2026-09-10', add });
    const now = runAdd({ debt: debtRow(), events: [disbursement, payment], add });

    expect(plain(past.text)).toContain(BACKDATED_NOTE);
    expect(plain(now.text)).not.toContain(BACKDATED_NOTE);
  });

  it('does not refuse a debt with no charges when the operation is an add (it still refuses an edit)', () => {
    expect(runAdd({ debt: debtRow(), add: { presets: { gmf: true }, charge: null } })).toMatchObject({ ok: true });
    expect(runCharge({ debt: debtRow(), draft: { chargeRef: 'seguro' } }).ok).toBe(false);
  });
});

describe('rebuildCharges: add (Confirm)', () => {
  it('adds the presets and the explicit charge to the charges in force now', () => {
    const rebuiltAdd = rebuildCharges(CHARGES.slice(0, 2), { op: 'add', add: { presets: { iva: 19, gmf: true }, charge: LIFE_12K } });

    expect(rebuiltAdd.charges.map((charge) => charge.id)).toEqual(['life', 'fee', 'iva', 'gmf', 'c1']);
    expect(rebuiltAdd.charges.find((charge) => charge.id === 'iva')).toMatchObject({ basis: 'pctOfCharge', refId: 'fee', value: 19 });
    expect(rebuiltAdd.added.map((charge) => charge.id)).toEqual(['iva', 'gmf', 'c1']);
  });

  it('takes the IVA included in the amount apart from the fee: 53,550 is a 45,000 fee and an IVA of 8,550', () => {
    const rebuiltAdd = rebuildCharges([], { op: 'add', add: { presets: { fee: 53550, iva: 19, ivaIncluded: true }, charge: null } });

    expect(rebuiltAdd.added.map((charge) => [charge.id, charge.value])).toEqual([['fee', 45000], ['iva', 19]]);
  });

  it('uses the card ids for a card, and reports a charge that no longer fits as an issue instead of throwing', () => {
    expect(rebuildCharges([], { op: 'add', add: { presets: { fee: 45000, iva: 19 }, charge: null } }, { card: true }).charges.map((charge) => charge.id)).toEqual(['mgmt_fee', 'mgmt_iva']);
    expect(rebuildCharges(CHARGES, { op: 'add', add: { presets: { fee: 9000 }, charge: null } })).toMatchObject({ issue: expect.stringContaining('ya existe') });
  });
});

describe('describeChargeAdd', () => {
  it('reports what was added with the next installment before and after', () => {
    const debt = debtRow();
    const added = addPresetCharge([], 'life', 0.05);
    const figures = previewChange(debt, [disbursement], { kind: 'charge_change', effectiveOn: TODAY, charges: added }, { on: TODAY });
    const text = plain(describeChargeAdd(debt, added, { effectiveOn: TODAY }, figures));

    expect(text).toContain('registré el cambio de cargos de Crédito Vehículo');
    expect(text).toContain('agregué Seguro de vida');
    expect(text).toContain(`Próxima cuota (con cargos): ${pesos(figures.before.nextTotalMinor)} → ${pesos(figures.after.nextTotalMinor)}`);
  });
});

// ---- restructure (NI3) ----
// Golden: 10,000,000 at 24% EA over 36 months with a 10,000 fee and mora at the usury cap (28.59% EA); the first installment
// (390,381) is 10 days late on 2026-02-25, so a restructure that day refinances 391,756 with the mora and 390,381 without.
const MORA_DAY = '2026-02-25';
const MORA_TERMS = { ...loanTerms, openedOn: '2026-01-15', firstDueOn: '2026-02-15', charges: [{ id: 'fee', kind: 'fee', label: 'Admin fee', basis: 'fixed', value: 10000, cadence: 'per_installment' }], late: { mode: 'usury' } };
const MORA_LEGAL = resolveLegal([], { usuryTable: [{ modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-12-31', capEA: 28.59, source: 'fixture', verified: true }] });
const moraDebt = (extra = {}) => debtRow(MORA_TERMS, { legal: MORA_LEGAL, ...extra });
const moraOpen = event('e0', 'disbursement', '2026-01-15', 10000000);
const restructure = ({ debt = moraDebt(), events = [moraOpen], today = MORA_DAY, draft = {} } = {}) =>
  previewRestructure({ debt, events, today, draft: { effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-04-15', ...draft } });
const rebuilt = (input) => rebuildRestructure({ debt: moraDebt(), events: [moraOpen], today: MORA_DAY, draft: { effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-04-15' }, ...input });

// The same figures from the core pieces, without going through Nia.
function oracle(waiveLate, { debt = moraDebt(), events = [moraOpen] } = {}) {
  const carry = restructureCarry(debt, events, MORA_DAY);
  const carriedMinor = carry.carriedMinor - (waiveLate ? carry.waivableLateMinor : 0);
  const terms = buildRestructureTerms(project(debt, events, MORA_DAY).terms, { effectiveOn: MORA_DAY, carriedMinor, overrides: { n: 48, firstDueOn: '2026-04-15' } });
  return { carriedMinor, terms, figures: previewChange(debt, events, { kind: 'restructure', effectiveOn: MORA_DAY, terms, ...(waiveLate ? { waiveLate: true } : {}) }, { on: MORA_DAY }) };
}

describe('readRestructure', () => {
  it('reads the term, system, periodicity, first due date and waiveLate, with the date defaulting to today', () => {
    expect(readRestructure({ n: 48, system: 'german', periodicity: 'biweekly', firstDueOn: '2026-12-05', waiveLate: true, effectiveOn: '2026-11-01' }, { today: TODAY }))
      .toEqual({ effectiveOn: '2026-11-01', n: 48, system: 'german', periodicity: 'biweekly', firstDueOn: '2026-12-05', waiveLate: true });
    expect(readRestructure({}, { today: TODAY })).toEqual({ effectiveOn: TODAY, n: null, system: null, periodicity: null, firstDueOn: null, waiveLate: false });
  });

  it('drops what is not valid instead of passing it on', () => {
    expect(readRestructure({ n: 0, system: 'none', periodicity: 'daily', firstDueOn: '2026-02-30', waiveLate: 'true', effectiveOn: 'mañana' }, { today: TODAY }))
      .toEqual({ effectiveOn: TODAY, n: null, system: null, periodicity: null, firstDueOn: null, waiveLate: false });
    expect(readRestructure(null, { today: TODAY }).n).toBeNull();
  });
});

describe('restructureDraft (what the pending keeps)', () => {
  const stated = { effectiveOn: TODAY, n: 48, system: null, periodicity: null, firstDueOn: '2026-12-05', waiveLate: false };

  it('keeps only what the user overrode', () => {
    expect(restructureDraft(stated)).toEqual({ effectiveOn: TODAY, n: 48, firstDueOn: '2026-12-05' });
    expect(restructureDraft({ ...stated, system: 'german', periodicity: 'monthly', waiveLate: true, rate: EA(20), rateValue: 20 }))
      .toEqual({ effectiveOn: TODAY, n: 48, firstDueOn: '2026-12-05', system: 'german', periodicity: 'monthly', waiveLate: true, rate: EA(20) });
  });

  it('keeps the stated value while the convention is missing, and the charges of the new plan', () => {
    const charges = [{ id: 'c1', kind: 'fee', label: 'Manejo', basis: 'fixed', value: 10000, cadence: 'per_installment' }];

    expect(restructureDraft({ ...stated, rate: null, rateValue: 2 })).toEqual({ effectiveOn: TODAY, n: 48, firstDueOn: '2026-12-05', rateValue: 2 });
    expect(restructureDraft({ ...stated, charges })).toMatchObject({ charges });
  });

  it('fits in the pending even with six charges and every override', () => {
    const charges = Array.from({ length: 6 }, (_, index) => ({ id: `c${index + 1}`, kind: 'insurance', label: `Seguro de vida número ${index + 1}`, basis: 'pctOutstanding', value: 0.05, cadence: 'per_installment' }));
    const draft = restructureDraft({ effectiveOn: TODAY, n: 48, system: 'german', periodicity: 'monthly', firstDueOn: '2026-12-05', waiveLate: true, rate: EA(20), charges });
    const pending = buildPending({ id: 'a'.repeat(24), action: 'restructure', awaiting: 'confirm', debtId: 'd'.repeat(36), draft });

    expect(Buffer.byteLength(JSON.stringify(pending), 'utf8')).toBeLessThan(PENDING_MAX_BYTES);
  });
});

describe('previewRestructure', () => {
  it('golden: shows what is refinanced, with the mora, the carried balance, the new installment and the term', () => {
    const result = restructure();
    const expected = oracle(false);
    const text = plain(result.text);

    expect(result.ok).toBe(true);
    expect(expected.carriedMinor).toBe(10192251);
    expect(text).toContain('Reestructuración de Crédito Vehículo');
    expect(text).toContain(`Saldo de capital: ${pesos(10000000)}`);
    expect(text).toContain(`Intereses vencidos: ${pesos(180876)}`);
    expect(text).toContain(`Cargos vencidos: ${pesos(10000)}`);
    expect(text).toContain(`Mora: ${pesos(1375)}`);
    expect(text).toContain(`Cuotas vencidas que se refinancian: ${pesos(391756)}`);
    expect(text).toContain(`Saldo que pasa al nuevo plan: ${pesos(10192251)}`);
    expect(text).toContain('48 cuotas');
    expect(text).toContain('Primera cuota: 2026-04-15');
    expect(text).toContain(`Cuota: ${pesos(expected.figures.before.installmentMinor)} → ${pesos(expected.figures.after.installmentMinor)}`);
    expect(expected.figures.after.installmentMinor).toBeGreaterThan(0);
    expect(text).toContain(`Cuotas restantes: ${expected.figures.before.remainingPeriods} → ${expected.figures.after.remainingPeriods}`);
    expect(text).toContain(`Intereses por pagar: ${pesos(expected.figures.before.remainingInterestMinor)} → ${pesos(expected.figures.after.remainingInterestMinor)}`);
    expect(text).toContain(`Costo restante (intereses y cargos): ${pesos(expected.figures.before.remainingCostMinor)} → ${pesos(expected.figures.after.remainingCostMinor)}`);
    expect(text).toContain('Aún no se guarda');
    expect(result.draft).toEqual({ effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-04-15' });
  });

  it('with waiveLate the mora is forgiven: it is shown apart and left out of the carried balance and of what is refinanced', () => {
    const result = restructure({ draft: { waiveLate: true } });
    const expected = oracle(true);
    const text = plain(result.text);

    expect(expected.carriedMinor).toBe(10190876);
    expect(text).toContain(`Mora condonada: ${pesos(1375)}`);
    expect(text).toContain(`Cuotas vencidas que se refinancian: ${pesos(390381)}`);
    expect(text).toContain(`Saldo que pasa al nuevo plan: ${pesos(10190876)}`);
    expect(text).not.toContain(`Mora: ${pesos(1375)}`);
    expect(result.draft.waiveLate).toBe(true);
  });

  it('shows the rate of the new plan with the EA echo and the usury notice from the household tables', () => {
    const legal = resolveLegal([{ kind: 'usury', modality: 'consumer', validFrom: '2026-02-01', validTo: '2026-02-28', value: 2900, source: 'Resolución', verified: true }]);
    const high = restructure({ debt: moraDebt({ legal }), draft: { rate: { value: 2.5, basis: 'effective', periodicity: 'monthly', timing: 'arrears' } } });
    const same = restructure();

    expect(high.ok).toBe(true);
    expect(plain(high.text)).toContain('Tasa: 2.5% MV ≈ 34.49% EA');
    expect(plain(high.text)).toContain('supera el tope de usura de 29% E.A.');
    expect(plain(high.text)).toContain('no bloquea');
    expect(plain(same.text)).toContain('Tasa: 24% EA');
    expect(plain(same.text)).not.toContain('usura');
  });

  it('applies the overrides on the new terms (system, periodicity) and says them', () => {
    const result = restructure({ draft: { system: 'german', periodicity: 'biweekly', firstDueOn: '2026-03-12' } });

    expect(result.ok).toBe(true);
    expect(plain(result.text)).toContain('48 cuotas quincenales');
    expect(plain(result.text)).toContain('abono fijo a capital');
  });

  it('puts the first installment one period after the effective date when it was not said', () => {
    const result = restructure({ draft: { firstDueOn: undefined } });

    expect(result.ok).toBe(true);
    expect(plain(result.text)).toContain('Primera cuota: 2026-03-25');
  });

  it('adds the backdated note when a recorded payment changes cost, and not otherwise', () => {
    const payment = event('p1', 'payment', MORA_DAY, 390381);
    const backdated = restructure({ events: [moraOpen, payment], today: '2026-03-20', draft: { effectiveOn: '2026-02-20', firstDueOn: '2026-04-15' } });
    const current = restructure();

    expect(plain(backdated.text)).toContain(BACKDATED_NOTE);
    expect(plain(current.text)).not.toContain(BACKDATED_NOTE);
  });

  it('measures a backdated restructure on its effective date, not on today', () => {
    const result = restructure({ today: '2026-03-20' });

    expect(plain(result.text)).toContain(`Cuotas vencidas que se refinancian: ${pesos(391756)}`);
    expect(plain(result.text)).toContain(`Saldo que pasa al nuevo plan: ${pesos(10192251)}`);
  });

  it('refuses a card without a preview', () => {
    const card = debtRow({ ...cardTerms, charges: [] }, { kind: 'card', name: 'Visa' });
    const result = restructure({ debt: card, events: [], draft: { effectiveOn: TODAY, firstDueOn: '2026-12-05' }, today: TODAY });

    expect(result).toMatchObject({ ok: false });
    expect(plain(result.issue)).toContain('tarjeta');
    expect(plain(result.issue)).toContain('No guardé nada');
  });

  it('explains a first installment on or before the effective date and an invalid plan, without a preview', () => {
    const early = restructure({ draft: { firstDueOn: MORA_DAY } });
    const bad = restructure({ draft: { periodicity: 'fortnightly' } });

    expect(early).toMatchObject({ ok: false });
    expect(plain(early.issue)).toContain('primera cuota');
    expect(plain(early.issue)).toContain(MORA_DAY);
    expect(bad).toMatchObject({ ok: false });
    expect(plain(bad.issue)).toContain('No pude armar el nuevo plan');
    expect(early.text).toBeUndefined();
  });

  it('needs a whole number of installments', () => {
    expect(restructure({ draft: { n: undefined } })).toMatchObject({ ok: false, issue: expect.stringContaining('cuotas') });
    expect(restructure({ draft: { n: 12.5 } })).toMatchObject({ ok: false });
  });

  it('says when the debt has nothing left to restructure', () => {
    const settled = debtRow({ ...loanTerms, principalMinor: 1000000, openedOn: '2026-09-10', n: 1, firstDueOn: '2026-10-10', rate: { convention: 'EA', value: 0 } });
    const events = [event('e0', 'disbursement', '2026-09-10', 1000000), event('p1', 'payment', '2026-10-10', 1000000)];
    const result = restructure({ debt: settled, events, today: TODAY, draft: { effectiveOn: TODAY, firstDueOn: '2026-12-05' } });

    expect(result).toMatchObject({ ok: false });
    expect(plain(result.issue)).toContain('no tiene saldo');
  });

  it('reports an unreadable debt in Spanish', () => {
    expect(restructure({ debt: moraDebt({ termsJson: '{' }) })).toMatchObject({ ok: false, issue: expect.stringContaining('No pude leer los términos') });
  });
});

describe('rebuildRestructure (Confirm)', () => {
  it('rebuilds from the live debt: a payment recorded after the preview changes the written carried balance', () => {
    const before = rebuilt();
    const payment = event('p1', 'payment', MORA_DAY, 100000);
    const after = rebuilt({ events: [moraOpen, payment] });

    expect(before.ok).toBe(true);
    expect(before.carriedMinor).toBe(10192251);
    expect(before.eventDraft.terms.principalMinor).toBe(10192251);
    expect(after.carriedMinor).toBe(10092251);
    expect(after.eventDraft.terms.principalMinor).toBe(10092251);
    expect(after.carry.arrears).toEqual({ interest: 92251, charges: 0, taxes: 0, lateInterest: 0 });
  });

  it('writes the draft as a restructure event with the terms of the live debt plus the overrides', () => {
    const { eventDraft } = rebuilt({ draft: { effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-04-15', rate: EA(20), waiveLate: true } });

    expect(eventDraft).toMatchObject({ kind: 'restructure', effectiveOn: MORA_DAY, waiveLate: true });
    expect(eventDraft.terms).toMatchObject({ n: 48, firstDueOn: '2026-04-15', openedOn: MORA_DAY, rate: EA(20), system: 'french', periodicity: 'monthly', late: { mode: 'usury' }, principalMinor: 10190876 });
    expect(rebuilt().eventDraft).not.toHaveProperty('waiveLate');
  });

  it('writes the same figures that the preview showed for the same debt', () => {
    const result = rebuilt();
    const expected = oracle(false);

    expect(result.figures.after).toEqual(expected.figures.after);
    expect(result.eventDraft.terms).toEqual(expected.terms);
  });

  it('refuses a plan whose event would not fit in 8000 characters', () => {
    const charges = Array.from({ length: 90 }, (_, index) => ({ id: `c${index + 1}`, kind: 'fee', label: `Cargo número ${index + 1}`, basis: 'fixed', value: 1000, cadence: 'per_installment' }));
    const result = rebuilt({ draft: { effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-04-15', charges } });

    expect(result).toMatchObject({ ok: false });
    expect(plain(result.issue)).toContain('demasiado grande');
    expect(plain(result.issue)).toContain('No guardé nada');
  });

  it('refuses invalid terms and a card instead of throwing', () => {
    expect(rebuilt({ draft: { effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-02-10' } })).toMatchObject({ ok: false, issue: expect.stringContaining('primera cuota') });
    expect(rebuilt({ draft: { effectiveOn: MORA_DAY, n: 0, firstDueOn: '2026-04-15' } })).toMatchObject({ ok: false });
    const card = debtRow({ ...cardTerms, charges: [] }, { kind: 'card', name: 'Visa' });
    expect(rebuilt({ debt: card, events: [] })).toMatchObject({ ok: false, issue: expect.stringContaining('tarjeta') });
  });
});

describe('describeRestructure', () => {
  it('reports the figures that were written: carried balance, new installment and term', () => {
    const built = rebuilt({ draft: { effectiveOn: MORA_DAY, n: 48, firstDueOn: '2026-04-15', waiveLate: true } });
    const text = plain(describeRestructure(moraDebt(), built));

    expect(text).toContain('registré la reestructuración de Crédito Vehículo desde 2026-02-25');
    expect(text).toContain(`Saldo refinanciado: ${pesos(10190876)}`);
    expect(text).toContain(`Mora condonada: ${pesos(1375)}`);
    expect(text).toContain(`Cuota: ${pesos(built.figures.after.installmentMinor)}`);
    expect(text).toContain(`Cuotas restantes: ${built.figures.after.remainingPeriods}`);
    expect(text).toContain('Primera cuota: 2026-04-15');
  });

  it('does not mention a waiver that was not asked for', () => {
    expect(plain(describeRestructure(moraDebt(), rebuilt()))).not.toContain('condonada');
  });
});
