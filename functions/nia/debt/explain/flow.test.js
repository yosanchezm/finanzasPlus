// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_TOPICS, explainFacts } from '../../../../packages/finance-core/index.js';
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
    const released = { ...facts('mora', null), status: 'ok' };

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
