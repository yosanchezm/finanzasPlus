import { EXPLAIN_TOPICS } from '../../../../packages/finance-core/index.js';
import { MAX_PICK_BUTTONS, explainButton } from '../pending.js';
import { paraphraseExplain } from './paraphrase.js';
import { TOPIC_LABELS, renderExplain } from './render.js';

// The replies of the explain flow (design G2 to G6): the topic menu, the debt pick, the stale-button texts and the
// explanation itself. Pure: no I/O, no session and no pending, so an explanation can never write. The handler owns
// the reads and the session (see `startExplain` and `handleExplainCallback` in handler.js). Node 16 safe.

const MENU_TEXT = 'Elige el tema que quieres que te explique:';
const MORE_LABEL = 'Ver más';
const PICK_TEXT = '¿De cuál deuda quieres la explicación?';
const NO_CARD_TEXT = 'No encuentro una tarjeta de crédito registrada, y ese tema aplica solo a tarjetas.';
// The topics that fit cards only (the core answers «no aplica» for the others); a pick offers just the debts they fit.
const CARD_TOPICS = ['card_statement', 'card_interest_drop'];
const isCard = (debt) => debt.kind === 'card' || Boolean(debt.terms && debt.terms.kind === 'card');
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

/** True for a topic that fits cards only. */
export const cardOnly = (topic) => CARD_TOPICS.includes(topic);

/** The debts a topic fits: the cards for a card topic, every debt for the other topics. */
export function applicableDebts(topic, debts) {
  return cardOnly(topic) ? debts.filter(isCard) : debts;
}

/** The pick between debts for an explanation: stateless explain buttons, no pending. Only the debts the topic fits are offered. */
export function pickReply(topic, debts) {
  const fit = applicableDebts(topic, debts);
  if (fit.length === 0) return { text: NO_CARD_TEXT };
  return { text: PICK_TEXT, keyboard: fit.slice(0, MAX_PICK_BUTTONS).map((debt) => [explainButton(topic, debt.$id, 1, String(debt.name).slice(0, 40))]) };
}

/** @param {'unknown_topic'|'debt_gone'} reason */
export const recoveryReply = (reason) => RECOVERY[reason];

/**
 * One part of the explanation with its buttons (design G6): «Ver más» (`nia:exp:<topic>:<debtId>:<n>`) while parts remain, then the
 * related topics. Every part carries its own footer. A status with no explanation (under review, not applicable) has no buttons.
 * @param {object} facts `explainFacts(...)`.
 * @param {{ debtId?: (string | null), page?: number }} [options] `page` is 1-based and is clamped to the parts that exist.
 * @returns {{ text: string, keyboard?: object[][] }}
 */
export function explainReply(facts, { debtId = null, page = 1 } = {}) {
  const { parts, followUps } = renderExplain(facts);
  const index = Math.min(Math.max(page, 1), parts.length) - 1;
  const rows = [];
  if (index + 1 < parts.length) rows.push([explainButton(facts.topic, debtId, index + 2, MORE_LABEL)]);
  for (const topic of followUps) rows.push([explainButton(topic, debtId, 1, TOPIC_LABELS[topic])]);
  return rows.length > 0 ? { text: parts[index], keyboard: rows } : { text: parts[index] };
}

/**
 * The explanation as `explainReply` builds it, with the text reworded only when `config.explainParaphrase` is on and the paraphrase passes the
 * guard (design G7). Anything else sends the template, with the same buttons. Off by default: then Gemini is not called.
 * @param {{ config?: object, gemini: Function }} deps
 * @param {object} facts `explainFacts(...)`.
 * @param {{ debtId?: (string | null), page?: number }} [options] As for `explainReply`.
 * @returns {Promise<{ text: string, keyboard?: object[][] }>}
 */
export async function explainReplyParaphrased(deps, facts, options = {}) {
  const reply = explainReply(facts, options);
  const text = await paraphraseExplain(deps, facts, reply.text);
  return text === null ? reply : { ...reply, text };
}
