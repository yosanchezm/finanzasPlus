import { ValidationError } from '../errors.js';
import { fnv1a } from './hash.js';
import { EXPLAIN_TOPICS } from './topics.js';

// Reviewed legal and educational copy and its release gate (design G8).
//
//   EXPLAIN_COPY[key] = { text, sources: [{ label, url? }], reviewedOn: 'YYYY-MM-DD' | null, reviewedHash: string | null }
//
// An entry is reviewed when it has text, at least one source, a `reviewedOn` date and a `reviewedHash`
// equal to `copyHash(entry)`, so any edit after the review un-reviews it. A key that a topic lists in
// `topicCopyKeys` but that is missing here counts as unreviewed. A topic is released only when all of its keys
// are reviewed; an unreleased topic is answered with "en revision". The owner review fills this object in.
// Pure and Node 16 safe.

export const EXPLAIN_COPY = {};

// The legal constants each topic depends on (spec: GMF, usura/IBC, Ley 1555, Ley 546, mora), then one sample key
// per topic so the owner reviews the wording of every topic (design owner Q2).
const LEGAL_KEYS = Object.freeze({
  usury_ibc: ['legal.usury_ibc', 'legal.ley546'],
  mora: ['legal.mora'],
  charges: ['legal.gmf'],
  prepayment: ['legal.ley1555'],
});

/** Throws the typed `unknown_topic` error, carrying the valid topics in `topics`. */
export function assertTopic(topic) {
  if (!EXPLAIN_TOPICS.includes(topic)) {
    const error = new ValidationError('unknown_topic', `unknown topic "${topic}"; valid topics: ${EXPLAIN_TOPICS.join(', ')}`);
    error.topics = EXPLAIN_TOPICS;
    throw error;
  }
}

/**
 * The copy keys a topic needs: its legal constants, then its sample key (always last).
 * @param {string} topic
 * @returns {string[]}
 */
export function topicCopyKeys(topic) {
  assertTopic(topic);
  return [...(LEGAL_KEYS[topic] || []), `${topic}.sample`];
}

const sourceLine = (source) => `${source && source.label ? source.label : ''}|${source && source.url ? source.url : ''}`;

/**
 * The fingerprint the review signs: the text and the sources.
 * @param {{ text: string, sources: { label: string, url?: string }[] }} entry
 * @returns {string}
 */
export function copyHash(entry) {
  const sources = Array.isArray(entry && entry.sources) ? entry.sources : [];
  return fnv1a(`${entry && entry.text}\n${sources.map(sourceLine).join('\n')}`);
}

function isReviewed(entry) {
  return (
    Boolean(entry) &&
    typeof entry.text === 'string' &&
    entry.text !== '' &&
    Array.isArray(entry.sources) &&
    entry.sources.length > 0 &&
    typeof entry.reviewedOn === 'string' &&
    entry.reviewedOn !== '' &&
    entry.reviewedHash === copyHash(entry)
  );
}

/**
 * Splits every needed key (and every key present in `copy`) into reviewed and unreviewed.
 * @param {object} [copy]
 * @returns {{ reviewed: string[], unreviewed: string[] }}
 */
export function copyStatus(copy = EXPLAIN_COPY) {
  const keys = [];
  const seen = new Set();
  const add = (key) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  EXPLAIN_TOPICS.forEach((topic) => topicCopyKeys(topic).forEach(add));
  Object.keys(copy).forEach(add);
  return {
    reviewed: keys.filter((key) => isReviewed(copy[key])),
    unreviewed: keys.filter((key) => !isReviewed(copy[key])),
  };
}

/**
 * The topics whose keys are all reviewed, in catalogue order.
 * @param {object} [copy]
 * @returns {string[]}
 */
export function releasedTopics(copy = EXPLAIN_COPY) {
  const reviewed = new Set(copyStatus(copy).reviewed);
  return EXPLAIN_TOPICS.filter((topic) => topicCopyKeys(topic).every((key) => reviewed.has(key)));
}
