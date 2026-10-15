import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { EXPLAIN_COPY, copyStatus, topicCopyKeys } from '../packages/finance-core/src/explain/copy.js';
import { EXPLAIN_TOPICS } from '../packages/finance-core/src/explain/topics.js';

// Release gate of the reviewed explanation copy (design G8, spec "Reviewed legal constants and release gate").
//   node scripts/check-explain-copy.mjs           fails (exit 1) while any key is missing or unreviewed
//   node scripts/check-explain-copy.mjs --print   lists every key with its status, text and sources, for the owner review
// `npm run package:nia` runs the same check before it builds the tarball. NIA_ALLOW_UNREVIEWED=1 is the explicit override:
// the S0 package uses it (it releases no topic) and so does a hotfix before the review; the topics without reviewed copy then
// answer "Este tema esta en revision".

const OVERRIDE = 'NIA_ALLOW_UNREVIEWED';

const neededKeys = () => [...new Set(EXPLAIN_TOPICS.flatMap((topic) => topicCopyKeys(topic)))];
const has = (copy, key) => Object.prototype.hasOwnProperty.call(copy, key);
const list = (title, keys) => (keys.length > 0 ? [`  ${title} (${keys.length}): ${keys.join(', ')}`] : []);

/**
 * @param {{ copy?: object, env?: object }} [options]
 * @returns {{ ok: boolean, override: boolean, missing: string[], unreviewed: string[], lines: string[] }}
 *   `missing` are the keys a topic needs that the copy does not have; `unreviewed` are the present keys that are not reviewed.
 */
export function checkExplainCopy({ copy = EXPLAIN_COPY, env = process.env } = {}) {
  const { unreviewed: notReviewed } = copyStatus(copy);
  const missing = notReviewed.filter((key) => !has(copy, key));
  const unreviewed = notReviewed.filter((key) => has(copy, key));
  const override = env[OVERRIDE] === '1';
  const lines = [];
  if (notReviewed.length === 0) {
    lines.push(`Explain copy check passed: ${copyStatus(copy).reviewed.length} keys are reviewed.`);
  } else if (override) {
    lines.push(`WARNING: ${OVERRIDE}=1 is set. Packaging with ${notReviewed.length} explain copy key(s) not reviewed; their topics answer "under review".`);
    lines.push(...list('missing', missing), ...list('unreviewed', unreviewed));
  } else {
    lines.push(`Explain copy check FAILED: ${notReviewed.length} key(s) are missing or not reviewed.`);
    lines.push(...list('missing', missing), ...list('unreviewed', unreviewed));
    lines.push(`Review the copy (node scripts/check-explain-copy.mjs --print) and set reviewedOn and reviewedHash for each approved key, or package with ${OVERRIDE}=1 to ship those topics as "under review".`);
  }
  return { ok: notReviewed.length === 0 || override, override, missing, unreviewed, lines };
}

/** Every key a topic needs, plus any other key in the copy: its status, its text and its sources. */
export function printExplainCopy(copy = EXPLAIN_COPY) {
  const { reviewed } = copyStatus(copy);
  const keys = [...neededKeys(), ...Object.keys(copy).filter((key) => !neededKeys().includes(key))];
  const lines = [];
  for (const key of keys) {
    const status = !has(copy, key) ? 'missing' : reviewed.includes(key) ? 'reviewed' : 'unreviewed';
    lines.push(`${key} [${status}]`);
    if (has(copy, key)) {
      lines.push(`  text: ${copy[key].text}`);
      for (const source of copy[key].sources || []) lines.push(`  source: ${source.label}${source.url ? ` <${source.url}>` : ''}`);
      if (copy[key].reviewedOn) lines.push(`  reviewedOn: ${copy[key].reviewedOn}`);
    }
  }
  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--print')) {
    console.log(printExplainCopy().join('\n'));
  } else {
    const result = checkExplainCopy();
    (result.ok && !result.override ? console.log : console.error)(result.lines.join('\n'));
    process.exitCode = result.ok ? 0 : 1;
  }
}
