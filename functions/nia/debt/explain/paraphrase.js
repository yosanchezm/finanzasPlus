import { MAX_REPLY, guardParaphrase } from '../guard.js';

// The optional paraphrase of an explanation (design G7, spec DE13 and NA10). The template is the canonical answer; this only
// rewords one rendered part. It is OFF by default (`config.explainParaphrase`), so by default explain makes no Gemini call beyond the
// classification and extraction. Gemini only rewords: a failure, a timeout or any reply the guard rejects returns `null`, and the caller
// sends the template. The source line and the disclaimer are never reworded: the template footer is kept exactly and added back.
// Enabling it adds one more Gemini call per explanation, which NA3 rules out by default, so enabling it is the owner's decision.
// Pure apart from the injected `gemini`. Node 16 safe.

const TIMEOUT_MS = 8000;
const FOOTER = '\n\nFuente: ';
const ON = new Set(['true', '1', 'on', 'yes']);

/**
 * Reads the switch from an environment value: only an explicit on enables it, anything else (including a typo) keeps it off.
 * @param {unknown} value
 * @returns {boolean}
 */
export function paraphraseEnabled(value) {
  if (value === true) return true;
  return typeof value === 'string' && ON.has(value.trim().toLowerCase());
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('paraphrase timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Prompt of the paraphrase call. Gemini gets the rendered text and the pre-formatted figures (`facts.text`); `facts.numbers` is left out on
 * purpose so the model copies the formatted figures. The source line and the disclaimer are not part of the prompt.
 * @param {object} facts `explainFacts(...)`.
 * @param {string} body The rendered part without its footer.
 */
export function explainParaphrasePrompt(facts, body) {
  const given = { topic: facts.topic, asOf: facts.asOf, approximate: facts.approximate, text: facts.text, notices: facts.notices };
  return [
    'Eres Nia, asistente de finanzas personales. Reescribe esta explicación con un tono cercano y claro, en español, en máximo 800 caracteres y sin listas numeradas.',
    'Usa únicamente los hechos del JSON y el texto base. No calcules, no redondees, no conviertas ni inventes cifras: copia las cifras exactamente como aparecen en "text". Si una cifra está en "approximate", di que es aproximada y conserva la palabra «aproximado». No agregues fuentes ni avisos legales: se añaden aparte.',
    'Devuelve únicamente JSON válido con esta forma: {"reply":"texto"}.',
    `Texto base:\n${body}`,
    `Hechos:\n${JSON.stringify(given)}`,
  ].join('\n\n');
}

const flat = (value) => String(value).replace(/\s+/g, ' ');

// A figure the core marks as approximate must keep its «aproximado» label: a reply that states one without any label is rejected.
function dropsApproximate(facts, reply) {
  if (/aproximad/i.test(reply)) return false;
  const text = flat(reply);
  return (facts.approximate || []).some((key) => facts.text[key] !== undefined && text.includes(flat(facts.text[key])));
}

/**
 * A faithful paraphrase of one rendered explanation part, or `null` when the caller must send the template: the flag is off, there are no
 * figures to reword, Gemini failed or timed out, or the reply breaks the guard (a number that is not in the facts, a number spelled out, more
 * than 1,200 characters counting the footer that is added, or an approximate figure that lost its label).
 * @param {{ config?: { explainParaphrase?: boolean, paraphraseTimeoutMs?: number }, gemini: (prompt: string) => Promise<unknown> }} deps
 * @param {object} facts `explainFacts(...)`.
 * @param {string} template The rendered part with its footer (`explainReply(...).text`).
 * @returns {Promise<(string | null)>}
 */
export async function paraphraseExplain(deps, facts, template) {
  if (!deps.config || deps.config.explainParaphrase !== true) return null;
  if (!facts || facts.status !== 'ok') return null;
  const cut = template.lastIndexOf(FOOTER);
  if (cut < 0) return null;
  const body = template.slice(0, cut);
  const footer = template.slice(cut + 2);
  try {
    const raw = await withTimeout(deps.gemini(explainParaphrasePrompt(facts, body)), deps.config.paraphraseTimeoutMs || TIMEOUT_MS);
    // The rendered body is built from the facts and the reviewed copy, so its own figures (a law number, the debt name) are allowed too.
    const reply = guardParaphrase(raw && raw.reply, facts, [body, facts.debt && facts.debt.name], { maxChars: MAX_REPLY - footer.length - 2 });
    return reply === null || dropsApproximate(facts, reply) ? null : `${reply}\n\n${footer}`;
  } catch {
    return null;
  }
}
