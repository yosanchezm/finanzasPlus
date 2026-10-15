// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { explainFacts, serializeTerms } from '../../../../packages/finance-core/index.js';
import { reviewedCopy } from '../../../../packages/finance-core/test/helpers/explainCopy.js';
import { GOLDEN_LEGAL, GOLDEN_TERMS, TEN_DAYS_LATE, goldenDebt } from '../../../../packages/finance-core/test/helpers/lateGolden.js';
import { debt, ev, interestFree } from '../../../../packages/finance-core/test/helpers/loans.js';
import { handleDebt } from '../handler.js';
import { explainReply, explainReplyParaphrased } from './flow.js';
import { explainParaphrasePrompt, paraphraseEnabled, paraphraseExplain } from './paraphrase.js';

// Spec DE13 and NA10: the template is the canonical answer. A paraphrase is only tried when `config.explainParaphrase` is on (it is
// off by default, so explain makes no Gemini call beyond the extraction), and any rejection, failure or timeout sends the template.

const copy = reviewedCopy();
const DISCLAIMER = 'Información educativa con tus datos; no es asesoría financiera.';
const restructure = () => explainFacts('restructure_whatif', goldenDebt(), [], GOLDEN_LEGAL, TEN_DAYS_LATE, { copy });
const rates = () => explainFacts('rate_conventions', null, [], undefined, '2026-10-13', { copy, stated: { convention: 'NAMV', value: 25.2 } });
const templateOf = (facts) => explainReply(facts).text;
const footerOf = (template) => template.slice(template.lastIndexOf('\n\nFuente: ') + 2);
const faithful = (facts) => `En corto: hoy se refinancia ${facts.text.refinanced}; si te perdonan la mora, ${facts.text.refinancedWaived}.`;
const depsWith = (gemini, config = { explainParaphrase: true }) => ({ config, gemini });
const calls = () => {
  const list = [];
  return { list, gemini: async (prompt) => { list.push(prompt); return { reply: faithful(restructure()) }; } };
};

describe('paraphraseEnabled', () => {
  it('is off unless the value is an explicit on', () => {
    for (const value of ['true', '1', 'on', 'yes', ' TRUE ']) expect(paraphraseEnabled(value), value).toBe(true);
    for (const value of [undefined, null, '', 'false', '0', 'off', 'no', 'maybe', 2]) expect(paraphraseEnabled(value), String(value)).toBe(false);
  });
});

describe('paraphraseExplain', () => {
  it('makes no Gemini call and returns null while the flag is off (default)', async () => {
    const probe = calls();
    const template = templateOf(restructure());

    expect(await paraphraseExplain({ config: {}, gemini: probe.gemini }, restructure(), template)).toBeNull();
    expect(await paraphraseExplain({ config: { explainParaphrase: false }, gemini: probe.gemini }, restructure(), template)).toBeNull();
    expect(await paraphraseExplain({ config: { explainParaphrase: 'true' }, gemini: probe.gemini }, restructure(), template)).toBeNull();
    expect(probe.list).toEqual([]);
  });

  it('sends a faithful paraphrase with the exact source line and disclaimer kept', async () => {
    const facts = restructure();
    const template = templateOf(facts);
    const result = await paraphraseExplain(depsWith(async () => ({ reply: faithful(facts) })), facts, template);

    expect(result).toBe(`${faithful(facts)}\n\n${footerOf(template)}`);
    expect(result.endsWith(DISCLAIMER)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(1200);
  });

  it('asks for the reword of the template with the pre-formatted facts, never the raw numbers', async () => {
    const facts = restructure();
    const probe = calls();
    await paraphraseExplain(depsWith(probe.gemini), facts, templateOf(facts));
    const prompt = explainParaphrasePrompt(facts, templateOf(facts).slice(0, templateOf(facts).lastIndexOf('\n\nFuente: ')));

    expect(probe.list).toHaveLength(1);
    expect(prompt).toContain('"refinanced":"$ 391.756"');
    expect(prompt).not.toContain('"numbers"');
    expect(prompt).toContain('{"reply":"texto"}');
    expect(prompt).not.toContain('Fuente:');
    expect(prompt.endsWith(`Hechos:\n${prompt.split('Hechos:\n')[1]}`)).toBe(true);
  });

  it('falls back to the template when the paraphrase invents a figure (42 %)', async () => {
    const facts = restructure();
    const reply = `${faithful(facts)} Además la tasa sube un 42 %.`;

    expect(await paraphraseExplain(depsWith(async () => ({ reply })), facts, templateOf(facts))).toBeNull();
  });

  it('falls back to the template when 28.32 is changed to 28.23', async () => {
    const facts = rates();
    const template = templateOf(facts);
    const good = await paraphraseExplain(depsWith(async () => ({ reply: 'Esa tasa equivale a 28,32 % efectiva anual (aproximado).' })), facts, template);
    const bad = await paraphraseExplain(depsWith(async () => ({ reply: 'Esa tasa equivale a 28,23 % efectiva anual (aproximado).' })), facts, template);

    expect(good).toContain('28,32 % efectiva anual (aproximado)');
    expect(bad).toBeNull();
  });

  it('falls back to the template when a number is spelled out («cuatro por mil», «veintiocho»)', async () => {
    const facts = restructure();
    const template = templateOf(facts);

    for (const reply of ['El GMF es el cuatro por mil.', `${faithful(facts)} Son veintiocho por ciento.`, `${faithful(facts)} Ahorras la mitad.`]) {
      expect(await paraphraseExplain(depsWith(async () => ({ reply })), facts, template), reply).toBeNull();
    }
  });

  it('falls back to the template when the reply is over the cap, counting the footer that is added', async () => {
    const facts = restructure();
    const template = templateOf(facts);
    const room = 1200 - footerOf(template).length - 2;
    const fits = `${faithful(facts)} ${'a'.repeat(room - faithful(facts).length - 1)}`;

    expect(fits.length).toBe(room);
    expect(await paraphraseExplain(depsWith(async () => ({ reply: fits })), facts, template)).toHaveLength(1200);
    expect(await paraphraseExplain(depsWith(async () => ({ reply: `${fits}a` })), facts, template)).toBeNull();
    expect(await paraphraseExplain(depsWith(async () => ({ reply: 'x'.repeat(1300) })), facts, template)).toBeNull();
  });

  it('falls back to the template on a Gemini failure, a timeout and an unusable reply', async () => {
    const facts = restructure();
    const template = templateOf(facts);
    const timeout = { explainParaphrase: true, paraphraseTimeoutMs: 20 };

    expect(await paraphraseExplain(depsWith(async () => { throw new Error('quota'); }), facts, template)).toBeNull();
    expect(await paraphraseExplain(depsWith(() => new Promise(() => {}), timeout), facts, template)).toBeNull();
    for (const answer of [null, undefined, {}, { reply: 5 }, { reply: '   ' }, 'texto']) {
      expect(await paraphraseExplain(depsWith(async () => answer), facts, template), JSON.stringify(answer)).toBeNull();
    }
  });

  it('keeps the «aproximado» label: a paraphrase that drops it from approximate figures is rejected', async () => {
    const row = debt(interestFree());
    const facts = explainFacts('prepayment', row, [ev('payment', '2026-02-15', 100_000, {}, 'p1')], null, '2026-03-01', { copy, amountMinor: 300_000 });
    const template = templateOf(facts);
    const without = `Con ${facts.text.amount} te quedan ${facts.text.termPeriods} cuotas de ${facts.text.termInstallment} o ${facts.text.installPeriods} de ${facts.text.installInstallment}.`;
    const labelled = `${without.slice(0, -1)} (aproximado).`;

    expect(await paraphraseExplain(depsWith(async () => ({ reply: without })), facts, template)).toBeNull();
    expect(await paraphraseExplain(depsWith(async () => ({ reply: labelled })), facts, template)).toContain('(aproximado)');
  });

  it('does not call Gemini for a status that has no figures (generic, under review, not applicable)', async () => {
    const probe = calls();
    const generic = explainFacts('restructure_whatif', null, [], undefined, '2026-10-13', { copy });
    const review = explainFacts('restructure_whatif', goldenDebt(), [], GOLDEN_LEGAL, TEN_DAYS_LATE);
    const card = explainFacts('restructure_whatif', { ...goldenDebt(), terms: { ...GOLDEN_TERMS, kind: 'card', card: { statementDay: 20, dueDay: 10, minPayment: { rule: 'installments_due', pct: 0, floorMinor: 0 } } } }, [], GOLDEN_LEGAL, TEN_DAYS_LATE, { copy });

    for (const facts of [generic, review, card]) {
      expect(await explainReplyParaphrased(depsWith(probe.gemini), facts, {})).toEqual(explainReply(facts, {}));
    }
    expect(probe.list).toEqual([]);
  });
});

describe('explainReplyParaphrased', () => {
  it('returns the template reply unchanged while the flag is off, and the paraphrase with the same buttons when it is on', async () => {
    const facts = restructure();
    const template = explainReply(facts, { debtId: 'd1' });
    const off = await explainReplyParaphrased({ config: {}, gemini: async () => { throw new Error('must not be called'); } }, facts, { debtId: 'd1' });
    const on = await explainReplyParaphrased(depsWith(async () => ({ reply: faithful(facts) })), facts, { debtId: 'd1' });

    expect(off).toEqual(template);
    expect(on.text).toBe(`${faithful(facts)}\n\n${footerOf(template.text)}`);
    expect(on.keyboard).toEqual(template.keyboard);
  });

  it('sends the template when the paraphrase is rejected', async () => {
    const facts = restructure();
    const reply = await explainReplyParaphrased(depsWith(async () => ({ reply: 'Pagas un 42 % más.' })), facts, {});

    expect(reply).toEqual(explainReply(facts, {}));
  });
});

// The whole flow through the handler: the extraction is the only Gemini call unless the owner turns the paraphrase on.
describe('explain through the handler', () => {
  const ACTOR = 'telegram:1';
  const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
  const row = { $id: 'd1', householdId: 'h1', name: 'Crédito Vehículo', kind: 'vehicle', ownerScope: 'shared', status: 'active', lender: '', termsJson: serializeTerms(loanTerms) };
  const disbursement = { $id: 'e-d1', debtId: 'd1', householdId: 'h1', kind: 'disbursement', effectiveOn: '2026-09-10', amountMinor: 10000000, payloadJson: '{}', actorId: ACTOR, source: 'telegram', dedupeKey: 'seed:d1', $createdAt: '2026-09-10T12:00:00.000Z' };
  const tables = { debts: [row], debt_events: [disbursement], legal_rates: [] };

  function world(config, answers) {
    const sent = [];
    const prompts = [];
    const deps = {
      config: { householdId: 'h1', timezone: 'America/Bogota', currency: 'COP', ...config },
      explainCopy: reviewedCopy(),
      now: () => new Date('2026-10-13T15:00:00Z'),
      ids: { pending: () => 'p1' },
      listRows: async (table, where) => tables[table].filter((item) => Object.entries(where).every(([key, value]) => item[key] === value)),
      createRow: async () => { throw new Error('explain must not write'); },
      updateRow: async () => { throw new Error('explain must not write'); },
      deleteRow: async () => { throw new Error('explain must not write'); },
      cashflowRows: async () => [],
      gemini: async (prompt) => {
        prompts.push(prompt);
        const answer = answers.shift();
        return typeof answer === 'function' ? answer(prompt) : answer;
      },
      sendMessage: async (chatId, text, keyboard) => { sent.push({ text: text.replace(/ /g, ' '), keyboard }); },
      saveSession: async () => {},
    };
    return { deps, sent, prompts };
  }
  const profile = { ownerScope: 'you', appwriteUserId: ACTOR, alias: 'Camilo' };
  const ask = (w) => handleDebt(w.deps, { chatId: 'c1', actorId: '1', profile, text: 'qué pasa si reestructuro', history: [], previous: null, sessionStatus: 'conversation' });
  const extraction = { action: 'explain', topic: 'restructure_whatif' };
  const rewordFromPrompt = (prompt) => ({ reply: `Resumen: hoy se refinancia ${JSON.parse(prompt.split('Hechos:\n')[1]).text.refinanced}.` });

  it('makes only the extraction call by default and sends the template', async () => {
    const w = world({}, [extraction]);
    await ask(w);

    expect(w.prompts).toHaveLength(1);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('Si reestructuras hoy (13 de octubre de 2026)');
    expect(w.sent[0].text.endsWith(DISCLAIMER)).toBe(true);
  });

  it('adds one paraphrase call and sends a faithful paraphrase when the flag is on', async () => {
    const w = world({ explainParaphrase: true }, [extraction, rewordFromPrompt]);
    await ask(w);

    expect(w.prompts).toHaveLength(2);
    expect(w.sent[0].text).toMatch(/^Resumen: hoy se refinancia \$ [\d.]+\./);
    expect(w.sent[0].text).toContain('Fuente: Crédito Vehículo · cálculo de reestructuración');
    expect(w.sent[0].text.endsWith(DISCLAIMER)).toBe(true);
  });

  it('sends the same template as the flag-off run when the paraphrase is rejected, fails or times out', async () => {
    const baseline = world({}, [extraction]);
    await ask(baseline);
    const invented = world({ explainParaphrase: true }, [extraction, { reply: 'Resumen: se refinancia un 42 %.' }]);
    await ask(invented);
    const failing = world({ explainParaphrase: true }, [extraction, () => { throw new Error('quota'); }]);
    await ask(failing);
    const hanging = world({ explainParaphrase: true, paraphraseTimeoutMs: 20 }, [extraction, () => new Promise(() => {})]);
    await ask(hanging);

    for (const w of [invented, failing, hanging]) {
      expect(w.prompts).toHaveLength(2);
      expect(w.sent[0].text).toBe(baseline.sent[0].text);
    }
  });
});
