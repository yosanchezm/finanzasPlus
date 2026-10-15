// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY, copyHash, copyStatus, releasedTopics, topicCopyKeys } from '../../src/explain/copy.js';
import { explainFacts } from '../../src/explain/explain.js';
import { fnv1a } from '../../src/explain/hash.js';
import { EXPLAIN_TOPICS, TOPIC_KINDS } from '../../src/explain/topics.js';
import { debt as loanDebt, french } from '../helpers/loans.js';

const cardFixture = JSON.parse(readFileSync(new URL('../fixtures/card-statement-independent.json', import.meta.url), 'utf8'));
const loan = loanDebt(french());
const card = { $id: 'card1', householdId: 'h1', name: 'Visa', ownerScope: 'shared', terms: cardFixture.terms };

const SOURCES = [{ label: 'Superfinanciera', url: 'https://www.superfinanciera.gov.co' }];
const entry = (text, overrides = {}) => {
  const base = { text, sources: SOURCES, reviewedOn: null, reviewedHash: null };
  return { ...base, ...overrides };
};
const reviewed = (text) => {
  const base = entry(text, { reviewedOn: '2026-10-01' });
  return { ...base, reviewedHash: copyHash(base) };
};
const fullCopy = () => Object.fromEntries(EXPLAIN_TOPICS.flatMap((topic) => topicCopyKeys(topic)).map((key) => [key, reviewed(`texto ${key}`)]));

describe('EXPLAIN_TOPICS', () => {
  it('is the closed catalogue of nine topics, in order', () => {
    expect(EXPLAIN_TOPICS).toEqual([
      'rate_conventions',
      'usury_ibc',
      'mora',
      'payment_allocation',
      'charges',
      'card_statement',
      'card_interest_drop',
      'restructure_whatif',
      'prepayment',
    ]);
    expect(Object.isFrozen(EXPLAIN_TOPICS)).toBe(true);
  });

  it('marks the card-only and the loan-only topics and leaves the rest open', () => {
    expect(TOPIC_KINDS).toEqual({
      card_statement: 'card',
      card_interest_drop: 'card',
      restructure_whatif: 'loan',
      prepayment: 'loan',
    });
  });
});

describe('fnv1a', () => {
  it('matches the published FNV-1a 32-bit vectors as 8 lowercase hex digits', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });

  it('hashes the UTF-8 bytes, so accents change the hash', () => {
    expect(fnv1a('mora')).not.toBe(fnv1a('morá'));
    expect(fnv1a('información')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('topicCopyKeys', () => {
  it('returns a stable list with the sample key of the topic last', () => {
    for (const topic of EXPLAIN_TOPICS) {
      const keys = topicCopyKeys(topic);
      expect(keys).toEqual(topicCopyKeys(topic));
      expect(keys[keys.length - 1]).toBe(`${topic}.sample`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('lists the legal constants under the topics that use them', () => {
    expect(topicCopyKeys('usury_ibc')).toEqual(['legal.usury_ibc', 'legal.ley546', 'usury_ibc.sample']);
    expect(topicCopyKeys('mora')).toEqual(['legal.mora', 'mora.sample']);
    expect(topicCopyKeys('charges')).toEqual(['legal.gmf', 'charges.sample']);
    expect(topicCopyKeys('prepayment')).toEqual(['legal.ley1555', 'prepayment.sample']);
    expect(topicCopyKeys('payment_allocation')).toEqual(['payment_allocation.sample']);
  });

  it('rejects a topic outside the catalogue', () => {
    expect(() => topicCopyKeys('tax_returns')).toThrow(expect.objectContaining({ code: 'unknown_topic' }));
  });
});

describe('copyStatus', () => {
  it('counts a key that is listed by a topic but missing from the copy as unreviewed', () => {
    const status = copyStatus({});
    expect(status.reviewed).toEqual([]);
    expect(status.unreviewed).toEqual(expect.arrayContaining(['legal.gmf', 'mora.sample', 'prepayment.sample']));
    expect(status.unreviewed.length).toBe(new Set(EXPLAIN_TOPICS.flatMap((topic) => topicCopyKeys(topic))).size);
  });

  it('counts an entry with reviewedOn but no matching reviewedHash as unreviewed', () => {
    const noHash = entry('Texto', { reviewedOn: '2026-10-01' });
    const wrongHash = entry('Texto', { reviewedOn: '2026-10-01', reviewedHash: '00000000' });
    const status = copyStatus({ 'legal.gmf': noHash, 'legal.mora': wrongHash });
    expect(status.reviewed).toEqual([]);
    expect(status.unreviewed).toEqual(expect.arrayContaining(['legal.gmf', 'legal.mora']));
  });

  it('counts a reviewed entry as reviewed, and an edited text, an edited source or a missing source as unreviewed', () => {
    const good = reviewed('Texto aprobado');
    expect(copyStatus({ 'legal.gmf': good }).reviewed).toEqual(['legal.gmf']);
    expect(copyStatus({ 'legal.gmf': { ...good, text: 'Texto aprobado y editado' } }).reviewed).toEqual([]);
    expect(copyStatus({ 'legal.gmf': { ...good, sources: [{ label: 'Otra fuente' }] } }).reviewed).toEqual([]);
    const withoutSources = { ...good, sources: [] };
    expect(copyStatus({ 'legal.gmf': { ...withoutSources, reviewedHash: copyHash(withoutSources) } }).reviewed).toEqual([]);
  });

  it('lists an entry that no topic asks for under its own status', () => {
    const status = copyStatus({ 'extra.note': entry('Sin revisar') });
    expect(status.unreviewed).toContain('extra.note');
  });

  it('reviews every key the shipped copy has: the owner approval of 2026-10-15', () => {
    const status = copyStatus(EXPLAIN_COPY);

    expect(status.unreviewed).toEqual([]);
    expect(status.reviewed.length).toBeGreaterThan(0);
  });
});

describe('releasedTopics', () => {
  it('is empty for the empty skeleton', () => {
    expect(releasedTopics({})).toEqual([]);
  });

  it('releases a topic only when every one of its keys is reviewed', () => {
    const copy = fullCopy();
    expect(releasedTopics(copy)).toEqual(EXPLAIN_TOPICS);
    delete copy['legal.mora'];
    expect(releasedTopics(copy)).not.toContain('mora');
    expect(releasedTopics(copy)).toContain('charges');
    copy['legal.mora'] = reviewed('texto legal.mora');
    copy['legal.mora'].text = 'editado despues de la revision';
    expect(releasedTopics(copy)).not.toContain('mora');
  });
});

describe('explainFacts', () => {
  it('rejects an unknown topic with the valid topics', () => {
    let error;
    try {
      explainFacts('tax_returns', loan, [], undefined, '2026-10-13');
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toMatchObject({ name: 'ValidationError', code: 'unknown_topic' });
    expect(error.topics).toEqual(EXPLAIN_TOPICS);
  });

  it('answers "not applicable" with no figures when the topic does not fit the debt kind', () => {
    const onLoan = explainFacts('card_statement', loan, [], undefined, '2026-10-13');
    expect(onLoan).toMatchObject({ topic: 'card_statement', status: 'not_applicable', numbers: {}, text: {}, debt: { id: 'd1', name: 'Credito', kind: 'loan' } });
    const onCard = explainFacts('prepayment', card, [], undefined, '2026-10-13');
    expect(onCard).toMatchObject({ status: 'not_applicable', numbers: {}, text: {}, debt: { id: 'card1', kind: 'card' } });
    expect(explainFacts('restructure_whatif', card, [], undefined, '2026-10-13').status).toBe('not_applicable');
    expect(explainFacts('card_interest_drop', loan, [], undefined, '2026-10-13').status).toBe('not_applicable');
  });

  it('answers "under review" for a topic whose copy is not released', () => {
    const facts = explainFacts('mora', loan, [], undefined, '2026-10-13', { copy: {} });
    expect(facts).toMatchObject({ topic: 'mora', asOf: '2026-10-13', status: 'under_review', numbers: {}, text: {}, copy: [], reviewedOn: null });
    expect(explainFacts('rate_conventions', null, [], undefined, '2026-10-13', { copy: {} }).status).toBe('under_review');
  });

  it('does not report "under review" once every key of the topic is reviewed', () => {
    const facts = explainFacts('mora', loan, [], undefined, '2026-10-13', { copy: fullCopy() });
    expect(facts.status).not.toBe('under_review');
    expect(facts.topic).toBe('mora');
    expect(facts.sources).toEqual(SOURCES);
    expect(facts.reviewedOn).toBe('2026-10-01');
  });

  it('is read-only: the debt and the events are not touched', () => {
    const events = Object.freeze([]);
    const frozen = Object.freeze({ ...loan });
    expect(() => explainFacts('mora', frozen, events, undefined, '2026-10-13')).not.toThrow();
  });
});
