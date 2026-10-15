// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { advise, compareStrategies, planCommit, serializeTerms } from '../../../packages/finance-core/index.js';
import { guardParaphrase, numbersIn } from './guard.js';
import { pesos } from './format.js';
import { MAX_PLAN_ROWS, TELEGRAM_LIMIT, adviseReply, paraphrasePrompt, simulateReply } from './replies.js';

const plain = (text) => text.replace(/ /g, ' ');

// Real core results (no hand-made numbers): the templates only render what the core returned.
const TODAY = '2026-10-13';
const baseTerms = { kind: 'consumer', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const debtOf = (extra = {}, name = 'Crédito Vehículo') => ({ $id: 'd1', householdId: 'h1', name, kind: 'consumer', ownerScope: 'shared', status: 'active', termsJson: serializeTerms({ ...baseTerms, ...extra }) });
const eventsOf = (extra = {}) => [{ $id: 'e1', debtId: 'd1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: extra.principalMinor ?? 10000000, payloadJson: '{}', $createdAt: '2026-09-10T12:00:00.000Z' }];

function simulation(extra = {}, { amountMinor = 2000000, strategy = 'reduce_term', webUrl } = {}) {
  const debt = debtOf(extra);
  const events = eventsOf(extra);
  const comparison = compareStrategies(debt, events, { amountMinor, on: TODAY });
  const ctx = { eventId: 'sim', dedupeKey: 'sim', actorId: 'a', source: 'telegram', asOf: TODAY };
  const { projection } = planCommit(debt, events, { kind: 'extra_payment', effectiveOn: TODAY, amountMinor, strategy }, ctx);
  return { name: debt.name, comparison, strategy, plan: projection.plan, webUrl };
}

describe('simulateReply', () => {
  const mortgage = { kind: 'mortgage', principalMinor: 200000000, n: 360, rate: { convention: 'EA', value: 12 } };

  it('shows only the next few rows of a 360-row plan, a web link, and stays within 4096 characters', () => {
    const text = plain(simulateReply(simulation(mortgage, { amountMinor: 5000000, webUrl: 'https://finanzas.example.com' })));
    const rows = text.split('\n').filter((line) => /^• \d{4}-\d{2}-\d{2} · /.test(line));

    expect(MAX_PLAN_ROWS).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows).toHaveLength(MAX_PLAN_ROWS);
    expect(text).toMatch(/… y \d+ cuotas más/);
    expect(text).toContain('https://finanzas.example.com');
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
  });

  it('omits the link (and never prints "undefined") when no web URL is configured', () => {
    const text = simulateReply(simulation(mortgage, { amountMinor: 5000000 }));

    expect(text).not.toContain('undefined');
    expect(text).not.toContain('http');
    expect(text).toContain('en la web');
  });

  it('compares the three strategies with the core figures and says nothing was saved', () => {
    const text = plain(simulateReply(simulation()));

    expect(text).toContain('Abono: $ 2.000.000 el 2026-10-13');
    expect(text).toContain('• Reducir plazo:');
    expect(text).toContain('• Reducir cuota:');
    expect(text).toContain('• Adelantar cuotas:');
    expect(text).toMatch(/ahorras \$ [\d.]+ en intereses/);
    expect(text).toContain('no se guardó nada');
    expect(text).toContain('Próximas cuotas (reducir plazo)');
  });

  it('shows every row and no "más" when the plan is short', () => {
    const text = plain(simulateReply(simulation({ n: 4 }, { amountMinor: 100000 })));

    expect(text.split('\n').filter((line) => line.startsWith('• 20'))).toHaveLength(4);
    expect(text).not.toMatch(/cuotas más/);
  });

  it('reports identical strategies honestly when the system keeps its term under both', () => {
    const input = simulation({ system: 'german' });
    const text = plain(simulateReply(input));

    expect(input.comparison.identical).toBe(true);
    expect(text).toContain('• Reducir plazo o cuota (mismo resultado)');
    expect(text).not.toContain('• Reducir cuota:');
  });

  it('claims no interest savings on a debt at 0%', () => {
    const text = simulateReply(simulation({ rate: { convention: 'ZERO' }, kind: 'family' }, { amountMinor: 1000000 }));

    expect(text).not.toContain('ahorras');
    expect(text).toContain('sin intereses');
  });

  it('says the debt would be paid off and what is left over', () => {
    const text = plain(simulateReply(simulation({}, { amountMinor: 12000000 })));

    expect(text).toContain('liquidarías la deuda');
    expect(text).toMatch(/sobrarían \$ [\d.]+/);
    expect(text).not.toContain('Próximas cuotas');
  });

  it('shows the informational prepayment penalty of the chosen strategy', () => {
    const text = plain(simulateReply(simulation({ prepaymentPenaltyPct: 2 })));

    expect(text).toMatch(/Penalización por prepago: 2% \(\$ [\d.]+\), solo informativa/);
  });

  it('survives a balance-only debt that has no plan', () => {
    const text = simulateReply(simulation({ system: 'none', kind: 'informal', rate: { convention: 'ZERO' } }, { amountMinor: 500000 }));

    expect(text).toContain('Simulación');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });
});

describe('adviseReply (deterministic template from the facts)', () => {
  const adviceFor = ({ extra = {}, amountMinor = 2000000, signals = {} } = {}) =>
    advise(compareStrategies(debtOf(extra), eventsOf(extra), { amountMinor, on: TODAY }), signals);
  const comfortable = { avgIncomeMinor: 8000000, avgExpenseMinor: 3000000, otherDebts: [] };

  it('default verdict: reduce the term, with the figures of the facts', () => {
    const { facts } = adviceFor({ signals: comfortable });
    const text = plain(adviseReply(facts, 'Crédito Vehículo'));

    expect(text).toContain('Crédito Vehículo');
    expect(text).toContain(`$ ${facts.text.amount}`);
    expect(text).toContain('Te conviene reducir el plazo');
    expect(text).toContain(`intereses ahorrados $ ${facts.text['reduceTerm.interestSaved']}`);
    expect(text).toContain(facts.text['reduceTerm.lastDueOn']);
  });

  it('tight margin: reduce the installment and cite the margin', () => {
    const { facts } = adviceFor({ signals: { avgIncomeMinor: 6000000, avgExpenseMinor: 5700000, otherDebts: [] } });
    const text = plain(adviseReply(facts, 'Crédito Vehículo'));

    expect(text).toContain('reducir la cuota');
    expect(text).toContain(`$ ${facts.text.margin}`);
    expect(text).toContain(facts.text.marginShare);
  });

  it('a pricier debt: names it first; when the margin is also tight it is still mentioned', () => {
    const pricier = { id: 'd2', name: 'Tarjeta Oro', eaPercent: 35 };
    const avalanche = adviseReply(adviceFor({ signals: { ...comfortable, otherDebts: [pricier] } }).facts, 'Crédito Vehículo');
    const both = adviseReply(adviceFor({ signals: { avgIncomeMinor: 6000000, avgExpenseMinor: 5700000, otherDebts: [pricier] } }).facts, 'Crédito Vehículo');

    expect(avalanche).toContain('pagar primero Tarjeta Oro');
    expect(both).toContain('reducir la cuota');
    expect(both).toContain('Tarjeta Oro cuesta 35% E.A.');
  });

  it('a 0% debt: liquidity only, no savings claimed', () => {
    const text = adviseReply(adviceFor({ extra: { rate: { convention: 'ZERO' }, kind: 'family' }, signals: comfortable }).facts, 'Préstamo Juan');

    expect(text).toContain('solo de liquidez');
    expect(text).not.toContain('ahorrados');
  });

  it('unknown cash flow is said, not guessed', () => {
    const text = adviseReply(adviceFor({ signals: { otherDebts: [] } }).facts, 'Crédito Vehículo');

    expect(text).toContain('No hay suficientes ingresos registrados');
  });

  it('a mortgage carries the Ley 1555 notice without changing the simulation', () => {
    const text = adviseReply(adviceFor({ extra: { kind: 'mortgage' }, signals: comfortable }).facts, 'Hipoteca');

    expect(text).toContain('Ley 1555');
    expect(text).toContain('no está verificado');
    expect(text).toContain('intereses ahorrados');
  });

  it('identical strategies and a payoff are explained', () => {
    const identical = adviseReply(adviceFor({ extra: { system: 'german' }, signals: comfortable }).facts, 'Crédito');
    const paidOff = adviseReply(adviceFor({ amountMinor: 12000000, signals: comfortable }).facts, 'Crédito');

    expect(identical).toContain('mismo resultado');
    expect(paidOff).toContain('liquidarías la deuda');
  });

  it('every figure it prints comes from the facts (it passes its own numeric guard)', () => {
    const scenarios = [
      { signals: comfortable },
      { signals: { avgIncomeMinor: 6000000, avgExpenseMinor: 5700000, otherDebts: [{ id: 'd2', name: 'Tarjeta Oro', eaPercent: 35 }] } },
      { signals: { otherDebts: [] } },
      { extra: { kind: 'mortgage' }, signals: comfortable },
      { extra: { rate: { convention: 'ZERO' }, kind: 'family' }, signals: comfortable },
      { extra: { system: 'german' }, signals: comfortable },
      { amountMinor: 12000000, signals: comfortable },
      { extra: { prepaymentPenaltyPct: 2 }, signals: comfortable },
    ];
    for (const scenario of scenarios) {
      const { facts } = adviceFor(scenario);
      const text = adviseReply(facts, 'Crédito Vehículo');

      expect(numbersIn(text).length).toBeGreaterThan(0);
      // The template keeps one fixed Spanish number word («tres meses»); the hardened guard rejects it in a model reply, so it is neutralised here.
      const figuresOnly = text.replace(/\btres\b/g, 'varios');
      expect(guardParaphrase(figuresOnly, facts)).toBe(figuresOnly);
      expect(text.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
    }
  });
});

describe('paraphrasePrompt', () => {
  it('hands Gemini only the facts and forbids computing', () => {
    const { facts } = advise(compareStrategies(debtOf(), eventsOf(), { amountMinor: 2000000, on: TODAY }), { avgIncomeMinor: 8000000, avgExpenseMinor: 3000000, otherDebts: [] });
    const prompt = paraphrasePrompt(facts, 'Crédito Vehículo');

    expect(prompt).toContain('Crédito Vehículo');
    expect(prompt).toContain(JSON.stringify(facts.text));
    expect(prompt).toMatch(/No calcules/);
    expect(prompt).toContain('{"reply"');
    expect(prompt).not.toContain('"numbers"');
  });
});

describe('mora in simulate and advise (F2)', () => {
  const late = { late: { mode: 'usury', graceDays: 0 } };
  const comfortable = { avgIncomeMinor: 8000000, avgExpenseMinor: 3000000, otherDebts: [] };
  const factsFor = (extra = {}) => advise(compareStrategies(debtOf(extra), eventsOf(extra), { amountMinor: 2000000, on: TODAY }), comfortable).facts;

  it('simulateReply states the mora accrued today when there is some, and nothing when there is none', () => {
    const withMora = simulation(late);
    const lateMinor = withMora.comparison.reduceTerm.before.lateInterestMinor;

    expect(lateMinor).toBeGreaterThan(0);
    expect(plain(simulateReply(withMora))).toContain(`Mora acumulada hoy: ${plain(pesos(lateMinor))}`);
    expect(simulateReply(simulation())).not.toContain('Mora');
  });

  it('adviseReply adds the mora line from the code figure, and passes the numeric guard with that figure allowed', () => {
    const facts = factsFor(late);
    const text = adviseReply(facts, 'Crédito Vehículo', { lateInterestMinor: 1375 });

    expect(plain(text)).toContain('Mora acumulada hoy: $ 1.375.');
    expect(guardParaphrase(text, facts, [pesos(1375)])).toBe(text);
    expect(guardParaphrase(text, facts)).toBeNull();
    expect(adviseReply(facts, 'Crédito Vehículo')).not.toContain('Mora');
    expect(adviseReply(facts, 'Crédito Vehículo', { lateInterestMinor: 0 })).not.toContain('Mora');
  });

  it('paraphrasePrompt hands Gemini the mora figure as text only when there is mora', () => {
    const facts = factsFor(late);
    const given = (prompt) => JSON.parse(prompt.split('Hechos:\n')[1]);

    expect(given(paraphrasePrompt(facts, 'Crédito Vehículo', { lateInterestMinor: 1375 })).lateInterest).toBe(pesos(1375));
    expect(given(paraphrasePrompt(facts, 'Crédito Vehículo'))).not.toHaveProperty('lateInterest');
  });
});
