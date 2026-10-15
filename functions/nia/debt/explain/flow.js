import { EXPLAIN_TOPICS } from '../../../../packages/finance-core/index.js';
import { MAX_PICK_BUTTONS, explainButton } from '../pending.js';
import { TOPIC_LABELS, renderExplain } from './render.js';

// The replies of the explain flow (design G2 to G6): the topic menu, the debt pick, the stale-button texts and the
// explanation itself. Pure: no I/O, no session and no pending, so an explanation can never write. The handler owns
// the reads and the session (see `startExplain` and `handleExplainCallback` in handler.js). Node 16 safe.

const MENU_TEXT = 'Elige el tema que quieres que te explique:';
const PICK_TEXT = '¿De cuál deuda quieres la explicación?';
const RECOVERY = {
  unknown_topic: 'Ese tema ya no está disponible. Pídeme “explícame” y te muestro los temas.',
  debt_gone: 'Esa deuda ya no está disponible. Escríbeme de nuevo qué quieres saber.',
};

/**
 * One button per topic. With a debt id every button explains that topic for that debt.
 * @param {(string | null)} [debtId]
 */
export function menuReply(debtId = null) {
  return { text: MENU_TEXT, keyboard: EXPLAIN_TOPICS.map((topic) => [explainButton(topic, debtId, 1, TOPIC_LABELS[topic])]) };
}

/** The pick between debts for an explanation: stateless explain buttons, no pending. */
export function pickReply(topic, debts) {
  return { text: PICK_TEXT, keyboard: debts.slice(0, MAX_PICK_BUTTONS).map((debt) => [explainButton(topic, debt.$id, 1, String(debt.name).slice(0, 40))]) };
}

/** @param {'unknown_topic'|'debt_gone'} reason */
export const recoveryReply = (reason) => RECOVERY[reason];

/**
 * The first part of the explanation, with its buttons if any. In S0 no topic is released, so this is the "under review" or "does not apply" text.
 * @param {object} facts `explainFacts(...)`.
 * @returns {{ text: string, keyboard?: object[][] }}
 */
export function explainReply(facts) {
  const { parts } = renderExplain(facts);
  return { text: parts[0] };
}
