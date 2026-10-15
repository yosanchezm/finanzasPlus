// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY, EXPLAIN_TOPICS, explainFacts } from '../../../../packages/finance-core/index.js';
import { reviewedCopy } from '../../../../packages/finance-core/test/helpers/explainCopy.js';
import { explainReply, menuReply, pickReply, recoveryReply } from './flow.js';
import { TOPIC_LABELS, UNDER_REVIEW_TEXT, renderExplain } from './render.js';

const loanTerms = { kind: 'vehicle', principalMinor: 10000000, openedOn: '2026-09-10', rate: { convention: 'EA', value: 24 }, system: 'french', periodicity: 'monthly', n: 36, firstDueOn: '2026-10-10' };
const cardTerms = JSON.parse(readFileSync(new URL('../../../../packages/finance-core/test/fixtures/card-statement-independent.json', import.meta.url), 'utf8')).terms;
const loan = { $id: 'd1', name: 'Crédito Vehículo', terms: loanTerms };
const card = { $id: 'c1', name: 'Visa', terms: cardTerms };
const facts = (topic, debt) => explainFacts(topic, debt, [], undefined, '2026-10-13');
const noDigits = (text) => expect(text).not.toMatch(/\d/);

describe('TOPIC_LABELS', () => {
  it('names every topic of the catalogue in Spanish and nothing else', () => {
    expect(Object.keys(TOPIC_LABELS)).toEqual(EXPLAIN_TOPICS);
    for (const label of Object.values(TOPIC_LABELS)) expect(label.length).toBeGreaterThan(3);
  });
});

describe('menuReply', () => {
  it('offers one button per topic, in catalogue order, and shows no figure', () => {
    const { text, keyboard } = menuReply();

    expect(keyboard.flat().map((button) => button.callback_data)).toEqual(EXPLAIN_TOPICS.map((topic) => `nia:exp:${topic}`));
    expect(keyboard.flat().map((button) => button.text)).toEqual(EXPLAIN_TOPICS.map((topic) => TOPIC_LABELS[topic]));
    expect(keyboard.every((row) => row.length === 1)).toBe(true);
    noDigits(text);
    expect(text.length).toBeGreaterThan(10);
  });

  it('carries the debt id on every button when a debt is chosen', () => {
    const { keyboard } = menuReply('d1');

    expect(keyboard.flat().map((button) => button.callback_data)).toEqual(EXPLAIN_TOPICS.map((topic) => `nia:exp:${topic}:d1`));
  });
});

describe('explainReply: nothing is released in S0', () => {
  it.each(EXPLAIN_TOPICS)('answers «Este tema está en revisión» for %s', (topic) => {
    const { text, keyboard } = explainReply(facts(topic, null));

    expect(text).toBe(UNDER_REVIEW_TEXT);
    expect(text).toContain('Este tema está en revisión');
    noDigits(text);
    expect(keyboard).toBeUndefined();
  });

  it('answers that a card topic does not apply to a loan, with no figures and no debt name', () => {
    const { text, keyboard } = explainReply(facts('card_statement', loan));

    expect(text).toMatch(/solo a tarjetas/);
    expect(text).not.toContain('Vehículo');
    noDigits(text);
    expect(keyboard).toBeUndefined();
  });

  it('answers that a loan topic does not apply to a card', () => {
    for (const topic of ['restructure_whatif', 'prepayment']) {
      const { text } = explainReply(facts(topic, card));
      expect(text).toMatch(/solo a préstamos/);
      noDigits(text);
    }
  });

  it('falls back to the under review text for a status it has no template for', () => {
    const released = { ...facts('card_statement', null), status: 'ok' };

    expect(explainReply(released).text).toBe(UNDER_REVIEW_TEXT);
    expect(renderExplain(released)).toEqual({ parts: [UNDER_REVIEW_TEXT], followUps: [] });
  });
});

describe('pickReply', () => {
  it('asks which debt with one explain button per candidate, at most 6', () => {
    const debts = Array.from({ length: 8 }, (_, index) => ({ $id: `d${index}`, name: `Deuda ${index}` }));
    const { text, keyboard } = pickReply('mora', debts);

    expect(text).toMatch(/cuál deuda/i);
    expect(keyboard.flat().map((button) => button.callback_data)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5'].map((id) => `nia:exp:mora:${id}`));
    expect(keyboard.flat()[0].text).toBe('Deuda 0');
  });
});

describe('recoveryReply', () => {
  it('gives a short safe text for each way a button can go stale', () => {
    for (const reason of ['unknown_topic', 'debt_gone']) {
      const text = recoveryReply(reason);
      expect(text.length).toBeGreaterThan(10);
      expect(text).toMatch(/ya no está disponible/);
      noDigits(text);
    }
    expect(recoveryReply('debt_gone')).not.toBe(recoveryReply('unknown_topic'));
  });
});

describe('explainReply: a released topic (injected reviewed copy)', () => {
  const copy = reviewedCopy();
  const released = (topic, row = loan, injected = copy) => explainFacts(topic, row, [], undefined, '2026-10-13', { copy: injected });
  const pairs = (keyboard) => keyboard.flat().map((button) => [button.text, button.callback_data]);
  const longSample = (key) => ({ ...EXPLAIN_COPY[key], text: `${'Primer párrafo del tema con una cifra de $ 1.234.567 y un detalle largo. '.repeat(9)}

${'Segundo párrafo del tema con otra cifra de $ 7.654.321 y más detalle. '.repeat(9)}` });

  it('sends part 1 with its footer, «Ver más» and the related topics when the answer has more parts', () => {
    const facts = released('usury_ibc');
    const { parts } = renderExplain(facts);
    const { text, keyboard } = explainReply(facts, { debtId: 'd1' });

    expect(parts.length).toBeGreaterThan(1);
    expect(text).toBe(parts[0]);
    expect(text).toContain('Fuente: Crédito Vehículo · tasas de usura e IBC');
    expect(text).toContain('Información educativa con tus datos; no es asesoría financiera.');
    expect(pairs(keyboard)).toEqual([
      ['Ver más', 'nia:exp:usury_ibc:d1:2'],
      [TOPIC_LABELS.rate_conventions, 'nia:exp:rate_conventions:d1'],
      [TOPIC_LABELS.mora, 'nia:exp:mora:d1'],
    ]);
  });

  it('sends part n with its own footer when «Ver más» is tapped, and no «Ver más» on the last part', () => {
    const facts = released('usury_ibc');
    const { parts } = renderExplain(facts);
    const last = explainReply(facts, { debtId: 'd1', page: parts.length });

    expect(last.text).toBe(parts[parts.length - 1]);
    expect(last.text).toContain('Fuente: Crédito Vehículo');
    expect(last.text).not.toBe(explainReply(facts, { debtId: 'd1' }).text);
    expect(pairs(last.keyboard).map(([label]) => label)).toEqual([TOPIC_LABELS.rate_conventions, TOPIC_LABELS.mora]);
    expect(explainReply(facts, { debtId: 'd1', page: 99 }).text).toBe(last.text);
  });

  it('offers only the related topics when the answer is a single part', () => {
    const { keyboard } = explainReply(released('payment_allocation'), { debtId: 'd1' });

    expect(pairs(keyboard)).toEqual([
      [TOPIC_LABELS.mora, 'nia:exp:mora:d1'],
      [TOPIC_LABELS.charges, 'nia:exp:charges:d1'],
    ]);
  });

  it('keeps the page callback within 64 bytes by dropping the debt id (the handler resolves it from the marker)', () => {
    const id = 'd'.repeat(36);
    const facts = released('payment_allocation', { ...loan, $id: id }, reviewedCopy({ ...EXPLAIN_COPY, 'payment_allocation.sample': longSample('payment_allocation.sample') }));
    const { keyboard } = explainReply(facts, { debtId: id });
    const [more, ...related] = pairs(keyboard);

    expect(more).toEqual(['Ver más', 'nia:exp:payment_allocation:-:2']);
    for (const [, data] of [more, ...related]) expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    expect(related.map(([, data]) => data)).toEqual([`nia:exp:mora:${id}`, `nia:exp:charges:${id}`]);
  });

  it('puts no debt id on any button when the answer is not about a debt', () => {
    const { keyboard } = explainReply(released('usury_ibc', null));

    expect(pairs(keyboard).map(([, data]) => data)).toEqual(['nia:exp:usury_ibc:-:2', 'nia:exp:rate_conventions', 'nia:exp:mora']);
  });
});
