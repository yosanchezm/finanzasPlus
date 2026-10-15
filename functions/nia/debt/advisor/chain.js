// The sequential chain of an adjustment (S6b, design G14). A plan with several steps runs one pending at a time: each step is previewed against the live
// debt with a fresh pending id (so its `dedupeKey` is `debt:{pendingId}`), has its own Confirm (`nia:confirm:<pendingId>`) and writes once. The chain rides in
// the pending as `chain = { debtId, now, done, rest }` (labels of the steps already done, the label of this one, and the steps still to run with their
// drafts), so no other store is needed. A failed step or a cancel stops it and reports what was done and what was not run. Pure and Node 16 safe.

export const STEP_RECORDED = 'Ese paso ya quedó registrado.';

/** The chain with its steps must leave room in a pending of 1.5 KB for the draft of any one step. */
export const CHAIN_MAX_BYTES = 700;

const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const stepOf = (item) => ({ a: item.action, d: item.draft });

/**
 * @param {string} debtId
 * @param {{ action: string, draft: object, label: string }[]} steps In the order to run (corrections first).
 * @returns {({ chain: object, step: { a: string, d: object } } | null)} The chain to attach to the pending of the first step and that step; `null` when the plan is too large.
 */
export function planChain(debtId, steps) {
  const [first, ...rest] = steps;
  const chain = { debtId, now: first.label, done: [], rest: rest.map((item) => ({ a: item.action, d: item.draft, l: item.label })) };
  return bytes(chain) > CHAIN_MAX_BYTES ? null : { chain, step: stepOf(first) };
}

/**
 * The chain after its current step was written.
 * @returns {({ chain: object, step: { a: string, d: object } } | null)} `null` when it was the last step.
 */
export function advanceChain(chain) {
  if (chain.rest.length === 0) return null;
  const [next, ...rest] = chain.rest;
  return { chain: { debtId: chain.debtId, now: next.l, done: [...chain.done, chain.now], rest }, step: { a: next.a, d: next.d } };
}

const list = (labels) => labels.map((label, index) => `${index + 1}. ${label}`).join('\n');

/**
 * What a stopped chain says: why it stopped, the steps done and the steps that were not run (the current one included).
 * @param {object} chain The chain of the step that was current.
 * @param {{ issue?: string, cancelled?: boolean }} reason
 */
export function chainReport(chain, { issue = '', cancelled = false } = {}) {
  const notRun = [chain.now, ...chain.rest.map((item) => item.l)];
  return [
    cancelled ? 'Cancelado. No guardé este paso ni los que faltaban.' : `Me detengo aquí: ${issue}`,
    chain.done.length > 0 ? `Hecho:\n${list(chain.done)}` : 'Hecho: nada todavía.',
    `No se ejecutó:\n${list(notRun)}`,
  ].join('\n\n');
}

/** The checklist of an adjustment: the steps in order, what Nia assumed and what it cannot save yet. */
export function checklistText(debtName, { steps, assumptions = [], unsupported = [] }) {
  const lines = [`Esto es lo que veo para ${debtName}:`, list(steps.map((item) => item.label))];
  const notes = [...assumptions, ...unsupported].map((item) => item.text);
  if (notes.length > 0) lines.push('', notes.join('\n'));
  lines.push('', 'Voy paso a paso: te muestro cada uno y solo se guarda lo que confirmes.');
  return lines.join('\n');
}
