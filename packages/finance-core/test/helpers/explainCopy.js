import { EXPLAIN_COPY, copyHash, topicCopyKeys } from '../../src/explain/copy.js';
import { EXPLAIN_TOPICS } from '../../src/explain/topics.js';

// A reviewed copy for tests: every key a topic needs, with the shipped text and sources when the key exists
// and a placeholder for the keys that later slices add. Only the review fields are set here; the shipped
// entries stay unreviewed (the owner gate G.2).
export function reviewedCopy(base = EXPLAIN_COPY) {
  const copy = {};
  for (const key of EXPLAIN_TOPICS.flatMap((topic) => topicCopyKeys(topic))) {
    const entry = base[key] || { text: `Texto de prueba de ${key}.`, sources: [{ label: 'Fuente de prueba' }] };
    const signed = { ...entry, reviewedOn: '2026-10-01', reviewedHash: null };
    copy[key] = { ...signed, reviewedHash: copyHash(signed) };
  }
  return copy;
}
