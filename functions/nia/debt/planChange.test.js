// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { previewChange, project, resolveLegal, serializeTerms } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { BACKDATED_NOTE, TOO_LOW_NOTE, modesFor, previewRateChange, readPlanChange } from './planChange.js';

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
