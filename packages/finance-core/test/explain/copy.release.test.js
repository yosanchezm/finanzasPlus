// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EXPLAIN_COPY, copyHash, copyStatus, releasedTopics, topicCopyKeys } from '../../src/explain/copy.js';
import { EXPLAIN_TOPICS } from '../../src/explain/topics.js';

// Release gate (tasks G.2, spec DE4): the owner approved the shipped copy on 2026-10-15, so the whole catalogue is
// released. Any later edit to a text or a source changes its hash and turns this suite red until it is reviewed again.
const REVIEW_DATE = '2026-10-15';
const NEEDED = [...new Set(EXPLAIN_TOPICS.flatMap((topic) => topicCopyKeys(topic)))];

describe('released explain copy', () => {
  it('releases the full catalogue of nine topics', () => {
    expect(EXPLAIN_TOPICS).toHaveLength(9);
    expect(releasedTopics()).toEqual(EXPLAIN_TOPICS);
  });

  it('has no unreviewed copy key', () => {
    const status = copyStatus(EXPLAIN_COPY);

    expect(status.unreviewed).toEqual([]);
    expect(status.reviewed).toHaveLength(NEEDED.length);
  });

  it.each(NEEDED)('records the owner review of %s with the hash of its exact text and sources', (key) => {
    const entry = EXPLAIN_COPY[key];

    expect(entry.reviewedOn).toBe(REVIEW_DATE);
    expect(entry.reviewedHash).toBe(copyHash(entry));
  });
});
