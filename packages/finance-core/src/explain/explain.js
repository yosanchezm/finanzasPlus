import { debtKindOf } from '../ledger/project.js';
import { EXPLAIN_COPY, assertTopic, releasedTopics, topicCopyKeys } from './copy.js';
import { TOPIC_KINDS } from './topics.js';

// Facts of an explanation (design G1). Pure and read-only. S0 ships the skeleton only: an unknown topic is
// rejected, a topic that does not fit the debt kind is "not_applicable", and a topic whose copy is not
// released is "under_review". The per-topic builders arrive with S1 to S3.

/**
 * @param {string} topic One of EXPLAIN_TOPICS.
 * @param {object|null} debt A debt row (`terms` or `termsJson`), or null when there is none.
 * @param {object[]} events The debt's events.
 * @param {object} legal The resolved legal tables.
 * @param {string} today ISO date.
 * @param {{ stated?: object, amountMinor?: number, copy?: object }} [opts]
 * @returns {{ topic: string, asOf: string, status: 'ok'|'generic'|'not_applicable'|'under_review',
 *   debt: ({ id: string, name: string, kind: 'loan'|'card' }|null), dataSource: 'debt'|'stated'|'generic',
 *   numbers: object, text: object, approximate: string[], notices: object[], copy: string[],
 *   sources: object[], reviewedOn: (string|null) }}
 */
export function explainFacts(topic, debt, events, legal, today, opts = {}) {
  assertTopic(topic);
  const copy = opts.copy || EXPLAIN_COPY;
  const kind = debt ? (debtKindOf(debt) === 'card' ? 'card' : 'loan') : null;
  const facts = {
    topic,
    asOf: today,
    status: 'generic',
    debt: debt ? { id: debt.$id, name: debt.name, kind } : null,
    dataSource: debt ? 'debt' : 'generic',
    numbers: {},
    text: {},
    approximate: [],
    notices: [],
    copy: [],
    sources: [],
    reviewedOn: null,
  };
  if (kind && TOPIC_KINDS[topic] && TOPIC_KINDS[topic] !== kind) return { ...facts, status: 'not_applicable' };
  if (!releasedTopics(copy).includes(topic)) return { ...facts, status: 'under_review' };
  const entries = topicCopyKeys(topic).map((key) => copy[key]);
  const dates = entries.map((entry) => entry.reviewedOn).sort();
  return {
    ...facts,
    copy: entries.map((entry) => entry.text),
    sources: entries[0].sources,
    reviewedOn: dates[dates.length - 1],
  };
}
