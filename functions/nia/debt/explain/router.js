import { EXPLAIN_TOPICS } from '../../../../packages/finance-core/index.js';
import { fold } from '../findDebt.js';

// Glossary router (design G2, spec "Glossary router"). It runs after the intent classification, only for a
// message the classifier left in `conversation` or `analysis`, and answers one question: is this a glossary
// question that names a debt concept? A question cue plus a concept keyword is required, and a write verb vetoes
// the message so "pague la mora" keeps its original action. It never writes and never calls a model.
// Pure and Node 16 safe.

// Every pattern below runs on text folded by `fold()` (lowercase, no accents, single spaces).
const WRITE_VERB = /\b(?:pague\w*|abon[ae]\w*|registr\w*|anota\w*|crea\w*|agrega\w*|cambia\w*|quita\w*|configura\w*|activa\w*|elimina\w*|borra\w*)/;

const LEADING_CUE = /^(?:y |pero |oye |nia |disculpa )?(?:que |como |cual |cuales |cuanto |cuanta |cuantos |cuantas |por que |porque |explica|explicame|me explicas|me puedes explicar|dime |cuentame|para que sirve|diferencia|donde |a donde )/;

// Most specific concept first: the first topic whose pattern matches wins.
const CONCEPTS = [
  ['card_interest_drop', /(?:baj\w*|sub\w*|cobra\w*|disminu\w*|aument\w*).*interes|interes\w*.*(?:baj\w*|sub\w*|disminu\w*|aument\w*)/],
  ['restructure_whatif', /reestructur|refinanci/],
  ['prepayment', /abono a capital|abonos a capital|prepag|ley 1555|abono extra|abonos extra|adelantar cuota/],
  ['payment_allocation', /como se aplica\w* (?:mi |el |un |los |mis )?pagos?|a donde va\w* (?:mi |el |un |los |mis )?pagos?|orden de (?:los )?pagos?|prelacion de (?:los )?pagos?|en que orden se pag/],
  ['mora', /\bmora\b|moratori/],
  ['usury_ibc', /usur|\bibc\b|interes bancario corriente|tasa maxima/],
  ['card_statement', /\bcorte\b|extracto|pago minimo|estado de cuenta/],
  ['rate_conventions', /\bnamv\b|\bnatv\b|\bnata\b|nominal|efectiv[ao]|mes vencido|anticipad[ao]|convencion de tasa/],
  ['charges', /4 ?x ?1000|cuatro por mil|\bgmf\b|cuota de manejo|\biva\b|seguro|\bcargos?\b|comision/],
  ['rate_conventions', /\binteres(?:es)?\b/],
];

const MARKER_MAX_CHARS = 60;

const hasCue = (original, folded) => /[¿?]/.test(original) || LEADING_CUE.test(folded);

/**
 * @param {string} text The user's message.
 * @param {{ marker?: ({ topic: string, debtId?: (string|null) } | null), hasAttachment?: boolean, released?: string[] }} [options]
 *   `marker` is the `{topic, debtId}` of the last explanation (`lastExplain`). `released` is accepted for callers that
 *   pass it, but unreleased topics route like any other: the reply says the topic is under review.
 * @returns {({ topic: string } | { topic: string, fromMarker: true } | null)}
 */
export function glossaryTopic(text, { marker = null, hasAttachment = false } = {}) {
  if (hasAttachment || typeof text !== 'string') return null;
  const folded = fold(text);
  if (folded === '' || WRITE_VERB.test(folded) || !hasCue(text, folded)) return null;
  const concept = CONCEPTS.find(([, pattern]) => pattern.test(folded));
  if (concept) return { topic: concept[0] };
  if (marker && EXPLAIN_TOPICS.includes(marker.topic) && text.trim().length <= MARKER_MAX_CHARS) {
    return { topic: marker.topic, fromMarker: true };
  }
  return null;
}
