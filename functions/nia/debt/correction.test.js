// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCorrection, normalizeRate, previewChange, serializeTerms } from '../../../packages/finance-core/index.js';
import { describeCorrection, previewCorrection, rebuildCorrection } from './correction.js';
import { BACKDATED_NOTE } from './planChange.js';

// The card fixture of the core (statement day 15, due day 30, minimum 5 % with a 20,000 floor, mora at the usury cap).
const fixture = JSON.parse(readFileSync(new URL('../../../packages/finance-core/test/fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
const cardTerms = { ...fixture.terms, late: { mode: 'usury', graceDays: 0 } };
const TODAY = '2026-06-01';
const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });
const plain = (text) => text.replace(/\u00a0/g, ' ');

const row = (terms, extra = {}) => ({ $id: 'd1', householdId: 'h1', name: 'Visa', kind: terms.kind, ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(terms), ...extra });
const event = (id, kind, effectiveOn, amountMinor, payload = {}) => ({ $id: id, debtId: 'd1', householdId: 'h1', kind, effectiveOn, amountMinor, payloadJson: JSON.stringify(payload), actorId: 'telegram:1', source: 'telegram', dedupeKey: `seed:${id}`, $createdAt: `${effectiveOn}T12:00:00.000Z` });
const card = () => row(cardTerms);
const payment = event('p1', 'payment', '2026-05-20', 140000);
const loanTerms = { kind: 'consumer', principalMinor: 10000000, openedOn: '2026-01-10', rate: { convention: 'EA', value: 28.32 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-02-10' };
const loan = () => row(loanTerms, { name: 'Crédito', kind: 'consumer' });
const disbursement = event('e0', 'disbursement', '2026-01-10', 10000000);

const run = ({ debt = card(), events = [], draft }) => previewCorrection({ debt, events, today: TODAY, draft });

describe('previewCorrection', () => {
  it('previews a statement day of 20 instead of 15, with the retroactive note and the question, and no backdated note when no cost changes', () => {
    const result = run({ draft: { card: { statementDay: 20 } } });
    const text = plain(result.text);

    expect(result.ok).toBe(true);
    expect(result.draft).toEqual({ card: { statementDay: 20 } });
    expect(text).toContain('Corrección de datos en Visa');
    expect(text).toContain('Día de corte: 15 → 20');
    expect(text).toContain('desde el inicio de la deuda');
    expect(text).toContain('Aún no se guarda');
    expect(text).not.toContain(BACKDATED_NOTE);
  });

  it('lists the due day and the minimum payment rule, percentage and floor that change, and only those', () => {
    const result = run({ draft: { card: { dueDay: 25, minPayment: { rule: 'pct_balance', pct: 10, floorMinor: 30000 } } } });
    const text = plain(result.text);

    expect(text).toContain('Día límite de pago: 30 → 25');
    expect(text).toContain('Pago mínimo: intereses, cuota de manejo y % del saldo → % del total del extracto');
    expect(text).toContain('Porcentaje del pago mínimo: 5 % → 10 %');
    expect(text).toContain('Piso del pago mínimo: $ 20.000 → $ 30.000');
    expect(text).not.toContain('Día de corte');
  });

  it('adds the backdated note when a recorded payment changes cost, with the exact copy of the spec, and not when none does', () => {
    const draft = buildCorrection(card(), [payment], { card: { minPayment: { pct: 3 } } }, { on: TODAY });
    const oracle = previewChange(card(), [payment], draft, { on: TODAY });
    const withPayment = run({ events: [payment], draft: { card: { minPayment: { pct: 3 } } } });

    expect(oracle.impacted).toHaveLength(1);
    expect(plain(withPayment.text)).toContain('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
    expect(BACKDATED_NOTE).toBe('Los costos de pagos anteriores se actualizarán cuando abras la deuda en la web.');
    expect(plain(run({ events: [], draft: { card: { dueDay: 25 } } }).text)).not.toContain(BACKDATED_NOTE);
  });

  it('echoes the rate as the bank states it with its E.A. equivalent: 25.2 % N.A.M.V. is 28.32 % E.A.', () => {
    const namv = normalizeRate({ convention: 'NAMV', value: 25.2 });
    const result = run({ debt: row({ ...loanTerms, rate: { convention: 'EA', value: 24 } }, { kind: 'consumer' }), events: [disbursement], draft: { rate: namv } });
    const text = plain(result.text);

    expect(result.ok).toBe(true);
    expect(text).toContain('Tasa: 24% EA → 25.2% NAMV ≈ 28.32% EA');
  });

  it('shows the modality with its Spanish name', () => {
    const result = run({ debt: loan(), events: [disbursement], draft: { modality: 'low_amount' } });

    expect(plain(result.text)).toContain('Modalidad: consumo y ordinario → consumo de bajo monto');
  });

  it('warns that registered statements may stop matching when the cut day moves, and not otherwise', () => {
    const statements = [event('a1', 'adjustment', '2026-04-15', 0, { balanceMinor: 1621102 }), event('a2', 'adjustment', '2026-05-15', 0, { balanceMinor: 1000000 })];

    expect(plain(run({ events: statements, draft: { card: { statementDay: 20 } } }).text)).toContain('Tienes 2 extractos registrados; revisa que coincidan');
    expect(plain(run({ events: statements, draft: { card: { dueDay: 25 } } }).text)).not.toContain('extractos registrados');
    expect(plain(run({ draft: { card: { statementDay: 20 } } }).text)).not.toContain('extractos registrados');
  });

  it('says nothing changes and refuses when the stated value is the stored one', () => {
    const same = run({ draft: { card: { statementDay: 15 } } });
    const partly = run({ draft: { card: { statementDay: 15, dueDay: 25 } } });

    expect(same).toMatchObject({ ok: false, issue: expect.stringContaining('no hay nada que corregir') });
    expect(same.issue).toContain('No guardé nada');
    expect(partly.ok).toBe(true);
    expect(plain(partly.text)).not.toContain('Día de corte');
  });

  it('refuses card fields on a loan and an unreadable debt, in Spanish', () => {
    expect(run({ debt: loan(), events: [disbursement], draft: { card: { statementDay: 20 } } })).toMatchObject({ ok: false, issue: expect.stringContaining('solo existen en tarjetas') });
    expect(run({ debt: row(cardTerms, { termsJson: '{' }), draft: { card: { statementDay: 20 } } })).toMatchObject({ ok: false, issue: expect.stringContaining('No pude leer los términos') });
    expect(run({ draft: { card: { statementDay: 40 } } })).toMatchObject({ ok: false, issue: expect.stringContaining('1 y 31') });
  });

  it('is read-only: the events are not touched', () => {
    const events = [payment];
    const before = JSON.stringify(events);
    run({ events, draft: { card: { statementDay: 20 } } });

    expect(JSON.stringify(events)).toBe(before);
  });
});

describe('rebuildCorrection and describeCorrection (Confirm)', () => {
  it('rebuilds the event from the live debt: fields, previous values and the version it belongs to', () => {
    const built = rebuildCorrection({ debt: card(), events: [], today: TODAY, draft: { card: { statementDay: 20 } } });

    expect(built.ok).toBe(true);
    expect(built.eventDraft).toEqual({ kind: 'terms_correction', effectiveOn: TODAY, amountMinor: 0, fields: { card: { statementDay: 20 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening' });
  });

  it('refuses at Confirm when the value became the stored one in the meantime', () => {
    const saved = event('c1', 'terms_correction', '2026-05-30', 0, { fields: { card: { statementDay: 20 } }, previous: { card: { statementDay: 15 } }, appliesTo: 'opening' });
    const built = rebuildCorrection({ debt: card(), events: [saved], today: TODAY, draft: { card: { statementDay: 20 } } });

    expect(built).toMatchObject({ ok: false, issue: expect.stringContaining('no hay nada que corregir') });
  });

  it('reports what was written, with the backdated note only when a past cost changes', () => {
    const quiet = rebuildCorrection({ debt: card(), events: [], today: TODAY, draft: { card: { statementDay: 20 } } });
    const costly = rebuildCorrection({ debt: card(), events: [payment], today: TODAY, draft: { card: { minPayment: { pct: 3 } } } });

    expect(plain(describeCorrection(card(), quiet))).toContain('registré la corrección de datos de Visa');
    expect(plain(describeCorrection(card(), quiet))).toContain('Día de corte: 15 → 20');
    expect(plain(describeCorrection(card(), quiet))).not.toContain(BACKDATED_NOTE);
    expect(plain(describeCorrection(card(), costly))).toContain(BACKDATED_NOTE);
  });
});
