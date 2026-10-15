// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY, copyStatus, releasedTopics, topicCopyKeys } from '../../src/explain/copy.js';
import { explainFacts } from '../../src/explain/explain.js';
import { reviewedCopy } from '../helpers/explainCopy.js';

// The draft copy of the loan topics (S1): legal constants for the usury and IBC, mora and GMF explanations, plus one
// sample per topic. Every entry waits for the owner review (gate G), so none carries a date or a hash.
const S1_TOPICS = ['rate_conventions', 'usury_ibc', 'mora', 'payment_allocation', 'charges'];
const S1_KEYS = ['legal.usury_ibc', 'legal.mora', 'legal.gmf', ...S1_TOPICS.map((topic) => `${topic}.sample`)];

describe('shipped explain copy (S1 draft)', () => {
  it.each(S1_KEYS)('has a draft entry for %s with text, sources and no review', (key) => {
    const entry = EXPLAIN_COPY[key];

    expect(entry.text.length).toBeGreaterThan(80);
    expect(entry.sources.length).toBeGreaterThan(0);
    for (const source of entry.sources) {
      expect(source.label.length).toBeGreaterThan(5);
      if (source.url !== undefined) expect(source.url).toMatch(/^https:\/\//);
    }
    expect(entry.reviewedOn).toBeNull();
    expect(entry.reviewedHash).toBeNull();
  });

  it('cites the Superintendencia Financiera for the IBC, the Estatuto Tributario for the GMF and the Codigo de Comercio for mora', () => {
    const labels = (key) => EXPLAIN_COPY[key].sources.map((source) => source.label).join(' | ');

    expect(labels('legal.usury_ibc')).toMatch(/Superintendencia Financiera/);
    expect(labels('legal.usury_ibc')).toMatch(/art\. 884/);
    expect(labels('legal.gmf')).toMatch(/Estatuto Tributario/);
    expect(labels('legal.mora')).toMatch(/art\. 886/);
  });

  it('keeps the GMF rate that the facts print in the copy text', () => {
    const facts = explainFacts('charges', null, [], undefined, '2026-10-13', { copy: reviewedCopy() });

    expect(facts.text.gmfRate).toBe('0,4 %');
    expect(EXPLAIN_COPY['legal.gmf'].text).toContain(facts.text.gmfRate);
  });

  it('releases no topic yet: every shipped entry is unreviewed and the Ley 546 and Ley 1555 keys are still missing', () => {
    const status = copyStatus(EXPLAIN_COPY);

    expect(status.reviewed).toEqual([]);
    expect(status.unreviewed).toEqual(expect.arrayContaining(S1_KEYS));
    expect(Object.keys(EXPLAIN_COPY).sort()).toEqual([...S1_KEYS].sort());
    expect(releasedTopics()).toEqual([]);
    expect(topicCopyKeys('usury_ibc').filter((key) => !EXPLAIN_COPY[key])).toEqual(['legal.ley546']);
  });
});
