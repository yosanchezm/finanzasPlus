import { pesos } from './format.js';

// Reply templates of the debt flow. Pure and Node 16 safe.

export const TELEGRAM_LIMIT = 4096;
const MAX_LIST_ITEMS = 15;
const CUT_NOTE = '\n… (mensaje recortado)';

/** Telegram rejects messages over 4096 characters: cut at a line break when possible. */
export function clampTelegram(text, limit = TELEGRAM_LIMIT) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit - CUT_NOTE.length);
  const cut = head.lastIndexOf('\n');
  return `${cut > limit / 2 ? head.slice(0, cut) : head}${CUT_NOTE}`;
}

const percent = (value) => `${Number(value.toFixed(2))}% E.A.`;

function itemLine(item) {
  if (item.unreadable) return `• ${item.name} · no pude leer sus términos`;
  const parts = [`• ${item.name}`, `saldo ${pesos(item.balanceMinor)}`];
  if (item.nextDue) {
    parts.push(`próxima cuota ${pesos(item.nextDue.amountMinor)} el ${item.nextDue.dueOn}`);
    if (item.eaPercent !== null && item.eaPercent !== undefined) parts.push(percent(item.eaPercent));
  } else {
    parts.push('sin cuotas pendientes');
  }
  if (item.pastDueMinor > 0) parts.push(`vencido ${pesos(item.pastDueMinor)}`);
  return parts.join(' · ');
}

/**
 * The list action.
 * @param {{ name: string, balanceMinor?: number, pastDueMinor?: number, eaPercent?: number,
 *   nextDue?: ({ dueOn: string, amountMinor: number } | null), unreadable?: boolean }[]} items Code-computed summaries.
 */
export function listReply(items) {
  if (items.length === 0) {
    return '💳 No hay deudas registradas todavía. Puedes crear una escribiéndome, por ejemplo: “Pedí un préstamo de 10 millones al 24% E.A. a 36 cuotas”.';
  }
  const total = items.filter((item) => !item.unreadable).reduce((sum, item) => sum + item.balanceMinor, 0);
  const lines = [`💳 Tus deudas (${items.length})`, '', ...items.slice(0, MAX_LIST_ITEMS).map(itemLine)];
  if (items.length > MAX_LIST_ITEMS) lines.push(`… y ${items.length - MAX_LIST_ITEMS} más en la web`);
  lines.push('', `Saldo total: ${pesos(total)}`);
  return lines.join('\n');
}

// Simulate and advise (NDA-5). Simulate renders the core's comparison; advise renders the core's
// structured `facts` with fixed Spanish sentences, so every figure is one the core produced and the
// text can stand in for a rejected or failed Gemini paraphrase.

/** A long plan is cut here: the user sees the next rows and goes to the web for the rest (spec: 3-12). */
export const MAX_PLAN_ROWS = 6;
const TITLES = { reduce_term: 'Reducir plazo', reduce_installment: 'Reducir cuota', advance_installments: 'Adelantar cuotas' };
const KEYS = { reduce_term: 'reduceTerm', reduce_installment: 'reduceInstallment', advance_installments: 'advance' };
const IDENTICAL_NOTE = 'En esta deuda reducir plazo y reducir cuota dan el mismo resultado: su plan no acorta el plazo con un abono.';
const LEY_1555 = 'Ley 1555: podrías prepagar una hipoteca sin penalización y elegir cómo aplicar el abono. Su alcance para esta deuda no está verificado; revisa tu contrato.';

const share = (value) => `${Number(value.toFixed(2))}%`;

function leftOf(snapshot) {
  if (snapshot.balanceMinor === 0) return 'deuda liquidada';
  if (snapshot.remainingPeriods > 0) return `${snapshot.remainingPeriods} cuotas de ${pesos(snapshot.installmentMinor)}`;
  return `saldo ${pesos(snapshot.balanceMinor)} sin cuotas`;
}

function savedText(run, claimsSavings) {
  if (!claimsSavings) return ' · sin intereses que ahorrar';
  const charges = run.savings.chargesMinor > 0 ? ` y ${pesos(run.savings.chargesMinor)} en cargos` : '';
  return ` · ahorras ${pesos(run.savings.interestMinor)} en intereses${charges}`;
}

/**
 * Reply of a simulation. Read-only: the caller pairs it with the `nia:simpay` button.
 * @param {{ name: string, comparison: object, strategy: 'reduce_term' | 'reduce_installment' | 'advance_installments',
 *   plan: object[], webUrl?: string }} input `comparison` is `compareStrategies(...)`; `plan` the rows after the chosen strategy.
 */
export function simulateReply({ name, comparison, strategy, plan, webUrl }) {
  const claims = comparison.eaPercent > 0;
  const chosen = comparison[KEYS[strategy]];
  const lines = [`🧮 Simulación de abono extra a ${name}`, `Abono: ${pesos(comparison.amountMinor)} el ${comparison.on}`, `Ahora: saldo ${pesos(chosen.before.balanceMinor)} · ${leftOf(chosen.before)}`, ''];
  if (chosen.paidOff) {
    lines.push(`Con este abono liquidarías la deuda: se aplicarían ${pesos(chosen.appliedMinor)} y sobrarían ${pesos(chosen.surplusMinor)}.`);
  } else {
    const entries = comparison.identical
      ? [['reduce_term', 'Reducir plazo o cuota (mismo resultado)'], ['advance_installments', TITLES.advance_installments]]
      : Object.entries(TITLES);
    for (const [key, title] of entries) lines.push(`• ${title}: ${leftOf(comparison[KEYS[key]].after)}${savedText(comparison[KEYS[key]], claims)}`);
    if (comparison.identical) lines.push(IDENTICAL_NOTE);
  }
  if (chosen.penaltyPct > 0) lines.push(`Penalización por prepago: ${share(chosen.penaltyPct)} (${pesos(chosen.penaltyMinor)}), solo informativa.`);
  const open = plan.filter((row) => row.outstandingMinor > 0);
  if (!chosen.paidOff && open.length > 0) {
    lines.push('', `Próximas cuotas (${TITLES[strategy].toLowerCase()}):`, ...open.slice(0, MAX_PLAN_ROWS).map((row) => `• ${row.dueOn} · ${pesos(row.outstandingMinor)}`));
    if (open.length > MAX_PLAN_ROWS) lines.push(`… y ${open.length - MAX_PLAN_ROWS} cuotas más. ${webUrl ? `Plan completo: ${webUrl}` : 'Puedes ver el plan completo en la web, en Deudas.'}`);
  }
  lines.push('', `Es solo una simulación: no se guardó nada. Para aplicarla toca «Registrar este abono» (${TITLES[strategy].toLowerCase()}) o dime con otra estrategia.`);
  return lines.join('\n');
}

const VERDICTS = {
  reduce_term: () => 'Te conviene reducir el plazo: es lo que más intereses ahorra.',
  reduce_installment: () => 'Te conviene reducir la cuota para cuidar tu flujo de caja.',
  liquidity_only: () => 'Esta deuda no cobra intereses, así que abonar no te ahorra dinero: la decisión es solo de liquidez.',
  avalanche: (facts) => `Te conviene pagar primero ${facts.targetDebt.name} (${facts.text['higherRate.ea']} E.A. frente a ${facts.text.ea} E.A. aquí).`,
};

const REASONS = {
  tight_margin: ({ text }) => `Tu margen mensual promedio de los últimos tres meses es $ ${text.margin} (${text.marginShare} de tus ingresos; el mínimo es ${text.marginThreshold}).`,
  installment_ratio: ({ text }) => `La cuota equivale a ${text.installmentShare} de tus ingresos (el máximo es ${text.installmentThreshold}).`,
  higher_rate_debt: (facts) => (facts.verdict === 'avalanche' ? null : `${facts.higherRateDebt.name} cuesta ${facts.text['higherRate.ea']} E.A., más que esta deuda (${facts.text.ea} E.A.).`),
  cashflow_unknown: () => 'No hay suficientes ingresos registrados en los últimos tres meses para medir tu margen.',
  strategies_identical: () => IDENTICAL_NOTE,
};

function factsStrategyLines(facts) {
  const { text } = facts;
  if (facts.paidOff) return [`Con este abono liquidarías la deuda: se aplicarían $ ${text.applied} y sobrarían $ ${text.surplus}.`];
  const entries = facts.identical ? [['reduceTerm', 'Reducir plazo o cuota (mismo resultado)'], ['advance', TITLES.advance_installments]] : Object.entries(KEYS).map(([strategy, key]) => [key, TITLES[strategy]]);
  return entries.map(([key, title]) => {
    const saved = facts.claimsSavings ? ` · intereses ahorrados $ ${text[`${key}.interestSaved`]}` : '';
    const last = text[`${key}.lastDueOn`] ? ` · última cuota el ${text[`${key}.lastDueOn`]}` : '';
    return `• ${title}: ${text[`${key}.periods`]} cuotas de $ ${text[`${key}.installment`]}${saved}${last}`;
  });
}

/**
 * Deterministic advice message built only from `facts` values (the numeric guard accepts it by construction).
 * @param {object} facts `advise(...).facts`.
 * @param {string} name The debt's name.
 */
export function adviseReply(facts, name) {
  const lines = [`💡 Recomendación para un abono de $ ${facts.text.amount} a ${name} (${facts.asOf})`, VERDICTS[facts.verdict](facts), '', ...factsStrategyLines(facts)];
  const reasons = [...new Set(facts.reasonCodes)].map((code) => (REASONS[code] ? REASONS[code](facts) : null)).filter(Boolean);
  if (reasons.length > 0) lines.push('', ...reasons);
  if (facts.numbers.penaltyPct > 0) lines.push(`Penalización por prepago: ${facts.text.penaltyPct} ($ ${facts.text.penalty}), solo informativa.`);
  if (facts.notices.some((notice) => notice.code === 'ley1555_scope_unverified')) lines.push('', `ℹ️ ${LEY_1555}`);
  lines.push('', 'Es una recomendación calculada con tus datos; la decisión es tuya.');
  return lines.join('\n');
}

/**
 * Prompt of the paraphrase call: Gemini only rewords the facts. `facts.numbers` is left out on purpose so the
 * model copies the pre-formatted `text` figures.
 */
export function paraphrasePrompt(facts, name) {
  const given = { debt: name, asOf: facts.asOf, verdict: facts.verdict, claimsSavings: facts.claimsSavings, identical: facts.identical, paidOff: facts.paidOff, reasonCodes: facts.reasonCodes, targetDebt: facts.targetDebt, higherRateDebt: facts.higherRateDebt, text: facts.text, notices: facts.notices };
  return [
    'Eres Nia, asistente de finanzas personales. Reescribe esta recomendación sobre un abono extra a una deuda con un tono cercano y claro, en español, en máximo 900 caracteres y sin listas numeradas.',
    'Usa únicamente los hechos del JSON. No calcules, no redondees, no conviertas ni inventes cifras: copia las cifras exactamente como aparecen en "text". Respeta el veredicto (verdict); si claimsSavings es false no prometas ahorros. Si hay avisos (notices), menciónalos con tus palabras.',
    'Devuelve únicamente JSON válido con esta forma: {"reply":"texto"}.',
    `Hechos:\n${JSON.stringify(given)}`,
  ].join('\n\n');
}
