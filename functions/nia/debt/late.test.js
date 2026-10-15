// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveLegal, serializeTerms } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { BACKDATED_NOTE } from './planChange.js';
import { describeLatePolicy, previewLatePolicy } from './late.js';

const TODAY = '2026-10-20'; // ten days after the first installment (due 2026-10-10)
const EA = (value) => ({ value, basis: 'effective', periodicity: 'annual', timing: 'arrears' });

// French 10,000,000 at 24% EA, 36 months; the first installment is 380,381 (180,876 interest + 199,505 principal), due 2026-10-10.
const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debtRow = (terms = loanTerms, extra = {}) => ({ $id: 'd1', householdId: 'h1', name: 'Crédito Vehículo', kind: terms.kind, ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(terms), ...extra });
const event = (id, kind, effectiveOn, amountMinor, payload = {}) => ({ $id: id, debtId: 'd1', householdId: 'h1', kind, effectiveOn, amountMinor, payloadJson: JSON.stringify(payload), actorId: 'telegram:1', source: 'telegram', dedupeKey: `seed:${id}`, $createdAt: `${effectiveOn}T12:00:00.000Z` });
const disbursement = event('e0', 'disbursement', '2026-09-10', 10000000);
// The card golden of the core (card.late.test.js): statement on the 20th, due on the 10th of the next month. The first minimum is 146,102,
// 21,102 of it interest, fees and taxes, so 125,000 of capital stays unmet when nothing is paid; 10 days at the 28.59% cap are 861.
const fixture = JSON.parse(readFileSync(new URL('../../../packages/finance-core/test/fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
const cardTerms = { ...fixture.terms, card: { ...fixture.terms.card, statementDay: 20, dueDay: 10 } };
const cap = { modality: 'consumer', validFrom: '2026-01-01', validTo: '2026-12-31', capEA: 28.59, source: 'test', verified: true };
const cardRow = (terms = cardTerms) => debtRow(terms, { kind: 'card', name: 'Visa', legal: resolveLegal([], { usuryTable: [cap] }) });
const CARD_TODAY = '2026-05-20'; // the statement close that bills the mora of the first minimum

const run = ({ debt = debtRow(), events = [disbursement], today = TODAY, effectiveOn = TODAY, late = { mode: 'usury', graceDays: 0 } } = {}) => previewLatePolicy({ debt, events, today, draft: { effectiveOn, late } });
const textOf = (result) => {
  expect(result.ok).toBe(true);
  return result.text;
};

describe('previewLatePolicy', () => {
  it('golden: 199,505 overdue 10 days at the 28.59% usury cap is 1,375 of mora', () => {
    const result = run({ effectiveOn: '2026-10-10' });
    const text = textOf(result);

    expect(text).toContain('Mora de Crédito Vehículo');
    expect(text).toContain('Modo: tasa de usura (el tope legal vigente)');
    expect(text).toContain('Desde: 2026-10-10');
    expect(text).toContain('Tope de usura vigente: 28.59% E.A.');
    expect(text).toContain('Tasa de mora: 28.59% E.A.');
    expect(text).toContain(`Mora acumulada al 2026-10-20: ${pesos(0)} → ${pesos(1375)}`);
    expect(result.draft).toEqual({ effectiveOn: '2026-10-10', late: { mode: 'usury', graceDays: 0 } });
  });

  it('golden: effective today it accrues nothing yet, and says the mora is not retroactive', () => {
    const text = textOf(run());

    expect(text).toContain('Desde: 2026-10-20');
    expect(text).toContain(`Mora acumulada al 2026-10-20: ${pesos(0)} → ${pesos(0)}`);
    expect(text).toContain('La mora no es retroactiva: se cobra desde el día siguiente a la fecha de vigencia');
    expect(text).toContain('¿Quieres registrar la mora así? Aún no se guarda.');
  });

  it('states that the cap applies when a fixed rate is above it (40% against 28.59%)', () => {
    const text = textOf(run({ late: { mode: 'fixed', graceDays: 0, rate: EA(40) } }));

    expect(text).toContain('Modo: tasa fija 40% EA');
    expect(text).toContain('Pediste 40% E.A., pero el tope de usura es 28.59% E.A.: se aplicará 28.59% E.A.');
    expect(text).toContain('Tasa de mora: 28.59% E.A.');
  });

  it('applies a fixed rate below the cap as it is, with no cap warning', () => {
    const text = textOf(run({ effectiveOn: '2026-10-10', late: { mode: 'fixed', graceDays: 0, rate: EA(20) } }));

    expect(text).toContain('Tasa de mora: 20% E.A.');
    expect(text).not.toContain('se aplicará');
    expect(text).toContain(`${pesos(0)} → ${pesos(997)}`);
  });

  it('previews a multiple of the contract rate: 1 time is 24% EA, 1.5 times is 36% and the cap wins', () => {
    const one = textOf(run({ late: { mode: 'contract_multiple', graceDays: 0, multiple: 1 } }));
    const more = textOf(run({ late: { mode: 'contract_multiple', graceDays: 0, multiple: 1.5 } }));

    expect(one).toContain('Modo: 1 vez la tasa del contrato');
    expect(one).toContain('Tasa de mora: 24% E.A.');
    expect(one).not.toContain('se aplicará');
    expect(more).toContain('Modo: 1.5 veces la tasa del contrato');
    expect(more).toContain('Eso equivale a 36% E.A., pero el tope de usura es 28.59% E.A.: se aplicará 28.59% E.A.');
  });

  it('shows the grace days when there are some', () => {
    expect(textOf(run({ late: { mode: 'usury', graceDays: 5 } }))).toContain('Días de gracia: 5');
    expect(textOf(run())).not.toContain('Días de gracia');
  });

  it('turns the mora off: the mode is none and the accrued mora so far stays', () => {
    const debt = debtRow({ ...loanTerms, late: { mode: 'usury', graceDays: 0 } });
    const text = textOf(run({ debt, effectiveOn: '2026-10-15', late: { mode: 'none', graceDays: 0 } }));

    expect(text).toContain('Modo: sin mora');
    expect(text).not.toContain('Tope de usura');
    expect(text).toContain(`Mora acumulada al 2026-10-20: ${pesos(1375)} → ${pesos(687)}`);
  });

  it('notes that the policy is already in force', () => {
    const debt = debtRow({ ...loanTerms, late: { mode: 'usury', graceDays: 0 } });

    expect(textOf(run({ debt }))).toContain('Esta política ya está vigente');
    expect(textOf(run())).not.toContain('ya está vigente');
  });

  it('warns, without blocking, when the cap table stops before the date and the last cap is carried forward', () => {
    const text = textOf(run({ today: '2026-12-20', effectiveOn: '2026-12-20' }));

    expect(text).toContain('El tope de usura más reciente que tengo es el vigente hasta 2026-10-31');
    expect(text).toContain('Tope de usura vigente: 28.59% E.A.');
  });

  it('says so when no cap is known and the contract rate is used', () => {
    const debt = debtRow(loanTerms, { legal: resolveLegal([], { usuryTable: [] }) });
    const text = textOf(run({ debt }));

    expect(text).toContain('No encontré un tope de usura para esta modalidad: usé la tasa del contrato (24% E.A.)');
    expect(text).not.toContain('Tope de usura vigente');
  });

  it('adds the Ley 546 notice for a mortgage', () => {
    const text = textOf(run({ debt: debtRow({ ...loanTerms, kind: 'mortgage' }) }));

    expect(text).toContain('Reglas de la Ley 546 no aplicadas');
    expect(textOf(run())).not.toContain('Ley 546');
  });

  it('adds the cost-update note when the policy reaches back before a recorded payment', () => {
    const payment = event('p1', 'payment', '2026-10-15', 380381);
    const backdated = textOf(run({ events: [disbursement, payment], effectiveOn: '2026-10-10' }));

    expect(backdated).toContain(BACKDATED_NOTE);
    expect(textOf(run({ events: [disbursement, payment] }))).not.toContain(BACKDATED_NOTE);
  });

  it('refuses an unreadable debt, writing nothing', () => {
    const broken = run({ debt: debtRow(loanTerms, { termsJson: '{' }) });

    expect(broken).toMatchObject({ ok: false });
    expect(broken.issue).toContain('No pude leer');
  });

  describe('a card', () => {
    const runCard = (extra = {}) => run({ debt: cardRow(), events: [], today: CARD_TODAY, effectiveOn: '2026-05-10', ...extra });

    it('golden: 125,000 of unmet capital for 10 days at the 28.59% cap is 861 of mora, billed at the next statement', () => {
      const result = runCard();
      const text = textOf(result);

      expect(text).toContain('Mora de Visa');
      expect(text).toContain('Modo: tasa de usura (el tope legal vigente)');
      expect(text).toContain('Desde: 2026-05-10');
      expect(text).toContain('Tope de usura vigente: 28.59% E.A.');
      expect(text).toContain('Tasa de mora: 28.59% E.A.');
      expect(text).toContain(`Mora acumulada al ${CARD_TODAY}: ${pesos(0)} → ${pesos(861)}`);
      expect(text).toContain('se cobra en el próximo extracto');
      expect(text).toContain('La mora no es retroactiva');
      expect(text).toContain('¿Quieres registrar la mora así? Aún no se guarda.');
      expect(result.draft).toEqual({ effectiveOn: '2026-05-10', late: { mode: 'usury', graceDays: 0 } });
    });

    it('does not say the mora is billed at the next statement for a loan', () => {
      expect(textOf(run())).not.toContain('próximo extracto');
    });

    it('echoes the cap when a fixed rate is above it, and accrues nothing when it takes effect today', () => {
      const text = textOf(runCard({ effectiveOn: CARD_TODAY, late: { mode: 'fixed', graceDays: 0, rate: EA(40) } }));

      expect(text).toContain('Pediste 40% E.A., pero el tope de usura es 28.59% E.A.: se aplicará 28.59% E.A.');
      expect(text).toContain(`Mora acumulada al ${CARD_TODAY}: ${pesos(0)} → ${pesos(0)}`);
    });

    it('notes that the policy is already in force', () => {
      const debt = cardRow({ ...cardTerms, late: { mode: 'usury', graceDays: 0 } });

      expect(textOf(runCard({ debt }))).toContain('Esta política ya está vigente');
    });

    it('turns the mora off and keeps what accrued', () => {
      const debt = cardRow({ ...cardTerms, late: { mode: 'usury', graceDays: 0 } });
      const text = textOf(runCard({ debt, effectiveOn: '2026-05-15', late: { mode: 'none', graceDays: 0 } }));

      expect(text).toContain('Modo: sin mora');
      expect(text).toContain(`Mora acumulada al ${CARD_TODAY}: ${pesos(861)} → ${pesos(431)}`);
    });
  });
});

describe('describeLatePolicy', () => {
  it('reports what was written, with the mora of the debt as it is now', () => {
    const preview = run({ effectiveOn: '2026-10-10' });
    const text = describeLatePolicy({ debt: debtRow(), draft: preview.draft, figures: preview.figures, today: TODAY });

    expect(text).toContain('✅ Listo: registré la mora de Crédito Vehículo: tasa de usura (el tope legal vigente) desde 2026-10-10');
    expect(text).toContain(`Mora acumulada al 2026-10-20: ${pesos(1375)}`);
  });

  it('says for a card that the mora is billed at the next statement', () => {
    const preview = run({ debt: cardRow(), events: [], today: CARD_TODAY, effectiveOn: '2026-05-10' });
    const text = describeLatePolicy({ debt: cardRow(), draft: preview.draft, figures: preview.figures, today: CARD_TODAY });

    expect(text).toContain('registré la mora de Visa');
    expect(text).toContain(`Mora acumulada al ${CARD_TODAY}: ${pesos(861)}`);
    expect(text).toContain('próximo extracto');
  });
});
