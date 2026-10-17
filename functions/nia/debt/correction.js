import { ValidationError, buildCorrection, previewChange, rateLabel } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { MODALITY_LABELS } from './legal.js';
import { BACKDATED_NOTE } from './planChange.js';
import { describeCoreError } from './preview.js';

// Terms correction of Nia (NA6, NA7): data that was wrong from the start. The draft the pending keeps is only what the user stated
// (`{ rate?, modality?, card? }`); the event is rebuilt from the live debt for the preview and again at Confirm, by the core's `buildCorrection`
// (it binds the correction to the terms version in force and drops what does not change). Every figure comes from the core's `previewChange`.
// Nia does not reconcile: the backdated note says the web repairs the cost rows. Nothing here writes. Pure and Node 16 safe.

const RULE_LABELS = {
  interest_fees_plus_pct: 'intereses, cuota de manejo y % del saldo',
  installments_due: 'intereses, cuota de manejo y cuotas del mes',
  pct_balance: '% del total del extracto',
};
const ISSUES = {
  no_change: 'Eso ya es lo que tengo registrado en la deuda; no hay nada que corregir. No guardé nada.',
  correction_not_applicable: 'El día de corte, el día de pago y el pago mínimo solo existen en tarjetas. No guardé nada.',
  invalid_card: 'Revisa los datos de la tarjeta: los días van entre 1 y 31, el porcentaje entre 0 y 100 y el piso en pesos enteros. No guardé nada.',
  correction_empty: 'No me dijiste qué dato corregir. No guardé nada.',
  not_a_statement_date: 'La fecha del último corte debe caer en el día de corte de la tarjeta. Revísala en tu extracto; no guardé nada.',
  last_statement_in_future: 'La fecha del último corte no puede ser posterior a hoy. No guardé nada.',
};

// The event the correction would write and the core replay of it, or the reason in Spanish (a typed error of the core).
function attempt(debt, events, draft, today) {
  try {
    const eventDraft = buildCorrection(debt, events, draft, { on: today });
    return { eventDraft, figures: previewChange(debt, events, eventDraft, { on: today }) };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { issue: ISSUES[error.code] || describeCoreError(error) };
  }
}

const change = (label, before, after) => `${label}: ${before} → ${after}`;

// One line per value that really changes (the core keeps only those in `corrected`).
function changeLines({ before, after }) {
  const lines = [];
  const was = before.card || {};
  const now = after.card || {};
  const wasPay = was.minPayment || {};
  const pay = now.minPayment || {};
  if (now.statementDay !== undefined) lines.push(change('Día de corte', was.statementDay, now.statementDay));
  if (now.dueDay !== undefined) lines.push(change('Día límite de pago', was.dueDay, now.dueDay));
  if (now.lastStatementOn !== undefined) lines.push(change('Fecha del último corte', was.lastStatementOn, now.lastStatementOn));
  if (now.openingMinimumMinor !== undefined) {
    lines.push(change('Pago mínimo del extracto', was.openingMinimumMinor === undefined ? 'sin dato' : pesos(was.openingMinimumMinor), pesos(now.openingMinimumMinor)));
  }
  if (pay.rule !== undefined) lines.push(change('Pago mínimo', RULE_LABELS[wasPay.rule], RULE_LABELS[pay.rule]));
  if (pay.pct !== undefined) lines.push(change('Porcentaje del pago mínimo', `${wasPay.pct} %`, `${pay.pct} %`));
  if (pay.floorMinor !== undefined) lines.push(change('Piso del pago mínimo', pesos(wasPay.floorMinor), pesos(pay.floorMinor)));
  if (after.rate) lines.push(change('Tasa', rateLabel(before.rate), rateLabel(after.rate))); // `rateLabel` carries the E.A. echo
  if (after.modality) lines.push(change('Modalidad', MODALITY_LABELS[before.modality], MODALITY_LABELS[after.modality]));
  return lines;
}

function statementsLine({ recorded, drifted }) {
  if (drifted === 0) return [];
  return [recorded === 1 ? 'Tienes 1 extracto registrado; revisa que coincida.' : `Tienes ${recorded} extractos registrados; revisa que coincidan.`];
}

/**
 * Preview of a correction: the values before and after, the E.A. echo of a rate, the retroactive note, a warning for the card statements already
 * recorded and, when a past cost changes, the backdated note. The returned `draft` is what the pending stores. Read-only.
 * @param {{ debt: object, events: object[], today: string, draft: { rate?: object, modality?: string, card?: object } }} input `debt` is a `debts` row.
 * @returns {{ ok: true, draft: object, text: string } | { ok: false, issue: string }}
 */
export function previewCorrection({ debt, events, today, draft }) {
  const built = attempt(debt, events, draft, today);
  if (built.issue) return { ok: false, issue: built.issue };
  const { figures } = built;
  const lines = [`🛠️ Corrección de datos en ${debt.name}`, 'Se aplica desde el inicio de la deuda: corrige un dato que estaba mal desde el principio, no es un cambio de hoy.', ''];
  lines.push(...changeLines(figures.corrected), ...statementsLine(figures.statements));
  if (figures.impacted.length > 0) lines.push(`ℹ️ ${BACKDATED_NOTE}`);
  lines.push('', '¿Quieres registrar la corrección así? Aún no se guarda.');
  return { ok: true, draft, text: lines.join('\n') };
}

/**
 * Rebuilds the correction from the LIVE debt and its events, for Confirm: the event to write and the core replay of it. A value that became the
 * stored one in the meantime is `no_change` and writes nothing.
 * @returns {{ ok: true, eventDraft: object, figures: ReturnType<typeof previewChange> } | { ok: false, issue: string }}
 */
export function rebuildCorrection({ debt, events, today, draft }) {
  const built = attempt(debt, events, draft, today);
  return built.issue ? { ok: false, issue: built.issue } : { ok: true, eventDraft: built.eventDraft, figures: built.figures };
}

/**
 * The reply after a correction was written.
 * @param {object} debt The live `debts` row.
 * @param {Extract<ReturnType<typeof rebuildCorrection>, { ok: true }>} built
 */
export function describeCorrection(debt, built) {
  const { figures } = built;
  const lines = [`✅ Listo: registré la corrección de datos de ${debt.name}, desde el inicio de la deuda.`, ...changeLines(figures.corrected)];
  if (figures.impacted.length > 0) lines.push(BACKDATED_NOTE);
  return lines.join('\n');
}
