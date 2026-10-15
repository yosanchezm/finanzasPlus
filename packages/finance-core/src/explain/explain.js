import { debtKindOf, project } from '../ledger/project.js';
import { legalOf } from '../legal.js';
import { EXPLAIN_COPY, assertTopic, releasedTopics, topicCopyKeys } from './copy.js';
import { allocationFacts } from './facts/allocation.js';
import { cardInterestDropFacts, cardStatementFacts } from './facts/card.js';
import { chargesFacts } from './facts/charges.js';
import { moraFacts } from './facts/mora.js';
import { ratesFacts } from './facts/rates.js';
import { usuryFacts } from './facts/usury.js';
import { TOPIC_KINDS } from './topics.js';

// Facts of an explanation (design G1). Pure and read-only. An unknown topic is rejected, a topic that does not fit
// the debt kind is "not_applicable", and a topic whose copy is not released is "under_review". Otherwise the topic's
// builder adds the figures (`numbers`, and `text` with the same figures pre-formatted). A topic with no builder yet
// (the restructure and prepayment topics of S3) keeps the generic answer.
const BUILDERS = {
  rate_conventions: ratesFacts,
  usury_ibc: usuryFacts,
  mora: moraFacts,
  payment_allocation: allocationFacts,
  charges: chargesFacts,
  card_statement: cardStatementFacts,
  card_interest_drop: cardInterestDropFacts,
};

const sameSource = (a, b) => a.label === b.label && a.url === b.url;
const uniqueSources = (entries) =>
  entries.reduce((list, entry) => list.concat(entry.sources.filter((source) => !list.some((seen) => sameSource(seen, source)))), []);

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
 *   sources: object[], reviewedOn: (string|null), copyKeys?: string[] }} `copy[i]` is the text of `copyKeys[i]`.
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
  const copyKeys = topicCopyKeys(topic);
  const entries = copyKeys.map((key) => copy[key]);
  const dates = entries.map((entry) => entry.reviewedOn).sort();
  const released = {
    ...facts,
    copy: entries.map((entry) => entry.text),
    copyKeys,
    sources: uniqueSources(entries),
    reviewedOn: dates[dates.length - 1],
  };
  const build = BUILDERS[topic];
  if (!build) return released;
  const tables = legalOf(debt || undefined, { legal });
  const projection = debt ? project(debt, events, today, { legal: tables }) : null;
  const built = build({ debt, projection, events, legal: tables, today, opts });
  return {
    ...released,
    status: built.status || 'ok',
    dataSource: built.dataSource || released.dataSource,
    numbers: built.numbers || {},
    text: built.text || {},
    approximate: built.approximate || [],
    notices: built.notices || [],
  };
}
