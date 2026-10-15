// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { allowedTexts } from '../../src/explain/allowed.js';
import { explainFacts } from '../../src/explain/explain.js';
import { GOLDEN_LEGAL, TEN_DAYS_LATE, goldenDebt } from '../helpers/lateGolden.js';
import { reviewedCopy } from '../helpers/explainCopy.js';

const copy = reviewedCopy();

describe('allowedTexts', () => {
  it('returns the printable figures, the copy texts, the source labels and the debt name', () => {
    const facts = explainFacts('mora', goldenDebt(), [], GOLDEN_LEGAL, TEN_DAYS_LATE, { copy });
    const allowed = allowedTexts(facts);

    expect(facts.copy.length).toBeGreaterThan(1);
    expect(facts.text.late).toBe('$ 1.375');
    expect(allowed).toEqual(expect.arrayContaining([...Object.values(facts.text), ...facts.copy, ...facts.sources.map((source) => source.label), 'Credito']));
    expect(allowed).toContain('$ 1.375');
  });

  it('has no debt name for a generic answer and only the name while the topic is under review', () => {
    const generic = explainFacts('mora', null, [], GOLDEN_LEGAL, TEN_DAYS_LATE, { copy });
    const review = explainFacts('mora', goldenDebt(), [], GOLDEN_LEGAL, TEN_DAYS_LATE);

    expect(allowedTexts(generic)).toEqual([...generic.copy, ...generic.sources.map((source) => source.label)]);
    expect(review.status).toBe('under_review');
    expect(allowedTexts(review)).toEqual(['Credito']);
  });
});
