import { ValidationError, capOn, compareIso, lateEAOn, legalOf, modalityOf, normalizeLate, previewChange, project, rateLabel, toEffectiveAnnual } from '../../../packages/finance-core/index.js';
import { pesos } from './format.js';
import { BACKDATED_NOTE } from './planChange.js';
import { describeCoreError } from './preview.js';

// Mora action of Nia (NI4, NI6): `late_policy` sets the late-interest policy of a loan from an effective date. The model only
// extracts the mode, the rate or multiple, the grace days and the date; every figure comes from the core's `previewChange`
// (the replay the web "Configurar mora" dialog uses) and the cap from `lateEAOn`, so the preview equals the projection once the
// event is saved. Nothing here writes. Pure and Node 16 safe.

export const CARD_LATE = 'La mora de las tarjetas todavía no se puede configurar desde aquí. Por ahora está disponible para préstamos.';
export const NOT_RETROACTIVE_NOTE = 'La mora no es retroactiva: se cobra desde el día siguiente a la fecha de vigencia, no por los días anteriores.';
const ALREADY_IN_FORCE = 'ℹ️ Esta política ya está vigente: registrarla no cambia la mora.';
const MORTGAGE_NOTE = 'ℹ️ Reglas de la Ley 546 no aplicadas: la mora de una hipoteca puede tener reglas propias, así que lo que ves es informativo.';
const NEW_CAP_HINT = 'Puedes registrar el nuevo tope diciéndome, por ejemplo: “la usura de noviembre es 28.2”.';

const percent = (value) => `${Number(value.toFixed(2))}% E.A.`;
const laterOf = (a, b) => (compareIso(a, b) > 0 ? a : b);

/** The mode of a policy in words: "tasa de usura (el tope legal vigente)", "tasa fija 40% EA", "1.5 veces la tasa del contrato", "sin mora". */
export function lateLabel(late) {
  if (late.mode === 'usury') return 'tasa de usura (el tope legal vigente)';
  if (late.mode === 'fixed') return `tasa fija ${rateLabel(late.rate)}`;
  if (late.mode === 'contract_multiple') return `${late.multiple === 1 ? '1 vez' : `${late.multiple} veces`} la tasa del contrato`;
  return 'sin mora';
}

// The EA the policy asks for before the cap (null for none and usury, which is the cap itself).
function requestedEA(late, terms) {
  if (late.mode === 'fixed') return toEffectiveAnnual(late.rate);
  if (late.mode === 'contract_multiple') return late.multiple * toEffectiveAnnual(terms.rate);
  return null;
}

function rateLines(late, terms, asOf, legal) {
  const { ea, notices } = lateEAOn({ ...terms, late }, asOf, legal);
  const cap = capOn(legal.usuryTable, modalityOf(terms), asOf);
  const lines = [];
  if (cap) lines.push(`Tope de usura vigente: ${percent(cap.capEA)}`);
  lines.push(`Tasa de mora: ${percent(ea)}`);
  const asked = requestedEA(late, terms);
  if (cap && asked !== null && asked > cap.capEA) {
    const lead = late.mode === 'fixed' ? 'Pediste' : 'Eso equivale a';
    lines.push(`ℹ️ ${lead} ${percent(asked)}, pero el tope de usura es ${percent(cap.capEA)}: se aplicará ${percent(cap.capEA)}.`);
  }
  return { lines, notices, ea, cap };
}

function noticeLines(notices, { cap, ea, late }) {
  const lines = [];
  const codes = new Set(notices.map((notice) => notice.code));
  if (codes.has('late_cap_stale')) {
    const { lastValidTo } = notices.find((notice) => notice.code === 'late_cap_stale');
    lines.push(`ℹ️ El tope de usura más reciente que tengo es el vigente hasta ${lastValidTo}; lo usé porque aún no hay uno para esta fecha. ${NEW_CAP_HINT}`);
  }
  if (codes.has('late_cap_unknown') || (!cap && late.mode !== 'none')) {
    const detail = late.mode === 'usury' ? `usé la tasa del contrato (${percent(ea)})` : `la mora usa ${percent(ea)} sin tope`;
    lines.push(`ℹ️ No encontré un tope de usura para esta modalidad: ${detail}. ${NEW_CAP_HINT}`);
  }
  if (codes.has('late_mortgage_unverified')) lines.push(MORTGAGE_NOTE);
  return lines;
}

const sameLate = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Preview of a mora policy: the mode, the effective date, the cap in force, the rate that will apply (the capped one when the
 * request is above the cap), the mora accrued as of today before and after, the legal notices and the note that mora is not
 * retroactive. A card is refused (its mora is not configurable from Nia yet). Read-only.
 * @param {{ debt: object, events: object[], today: string, draft: { effectiveOn: string, late: object } }} input `debt` is a `debts` row decorated with `legal`.
 * @returns {{ ok: true, draft: { effectiveOn: string, late: object }, figures: ReturnType<typeof previewChange>, text: string } | { ok: false, issue: string }}
 */
export function previewLatePolicy({ debt, events, today, draft }) {
  try {
    const projection = project(debt, events, today);
    if (projection.card) return { ok: false, issue: CARD_LATE };
    const late = normalizeLate(draft.late);
    const written = { effectiveOn: draft.effectiveOn, late };
    const figures = previewChange(debt, events, { kind: 'late_policy', ...written }, { on: today });
    const asOf = laterOf(today, draft.effectiveOn);
    const { terms } = projection;
    const lines = [`🕒 Mora de ${debt.name}`, `Modo: ${lateLabel(late)}`];
    if (late.mode !== 'none' && late.graceDays > 0) lines.push(`Días de gracia: ${late.graceDays}`);
    lines.push(`Desde: ${draft.effectiveOn}`);
    const rate = late.mode === 'none' ? null : rateLines(late, terms, asOf, legalOf(debt));
    if (rate) lines.push(...rate.lines);
    lines.push(`Mora acumulada al ${asOf}: ${pesos(figures.before.lateInterestMinor)} → ${pesos(figures.after.lateInterestMinor)}`);
    if (rate) {
      const lateNotices = [...figures.notices, ...rate.notices].filter((notice) => notice.code.startsWith('late_'));
      lines.push(...noticeLines(lateNotices, { cap: rate.cap, ea: rate.ea, late }));
    }
    lines.push(`ℹ️ ${NOT_RETROACTIVE_NOTE}`);
    if (sameLate(normalizeLate(terms.late), late)) lines.push(ALREADY_IN_FORCE);
    if (figures.impacted.length > 0) lines.push(`ℹ️ ${BACKDATED_NOTE}`);
    lines.push('', '¿Quieres registrar la mora así? Aún no se guarda.');
    return { ok: true, draft: written, figures, text: lines.join('\n') };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return { ok: false, issue: describeCoreError(error) };
  }
}

/**
 * The reply after a mora policy was written, with the figures of the debt as it is now.
 * @param {{ debt: object, draft: { effectiveOn: string, late: object }, figures: ReturnType<typeof previewChange>, today: string }} input
 *   `figures` is the core replay of the written change over the live events.
 */
export function describeLatePolicy({ debt, draft, figures, today }) {
  const lines = [`✅ Listo: registré la mora de ${debt.name}: ${lateLabel(draft.late)} desde ${draft.effectiveOn}.`];
  lines.push(`Mora acumulada al ${laterOf(today, draft.effectiveOn)}: ${pesos(figures.after.lateInterestMinor)}`);
  lines.push(NOT_RETROACTIVE_NOTE);
  if (figures.impacted.length > 0) lines.push(BACKDATED_NOTE);
  return lines.join('\n');
}
