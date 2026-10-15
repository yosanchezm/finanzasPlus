import { toEffectiveAnnual } from '@finance-core';
import { formatMoney } from '../../shared/lib/format';
import { formatDecimal, formatDueDate } from './debtLabels';
import { describeCorrection } from './termsCorrectionModel';

// One-line summaries of the plan-change events for the history, so they do not show up as "$ 0".

const twoDecimals = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatEaValue = (value) => `${twoDecimals.format(value)} % E.A.`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const MAX_LABELS = 2;

function rateSummary(event, { applied, card }) {
  const toEA = applied?.toEA ?? toEffectiveAnnual(event.payload.rate);
  const change = applied?.fromEA === undefined ? formatEaValue(toEA) : `${twoDecimals.format(applied.fromEA)} % → ${formatEaValue(toEA)}`;
  const mode = card ? '' : ` · ${event.payload.mode === 'keep_installment' ? 'mantiene cuota' : 'mantiene plazo'}`;
  return `Tasa: ${change} desde ${formatDueDate(event.effectiveOn)}${mode}`;
}

// Added or modified charges by label, then the removed ones ("sin Seguro"); two labels at most, the rest as "(+n)".
function chargesSummary(event, { previousCharges = [] }) {
  const before = new Map(previousCharges.map((charge) => [charge.id, JSON.stringify(charge)]));
  const next = event.payload.charges;
  const kept = new Set(next.map((charge) => charge.id));
  const changed = next.filter((charge) => before.get(charge.id) !== JSON.stringify(charge)).map((charge) => charge.label ?? charge.id);
  const removed = previousCharges.filter((charge) => !kept.has(charge.id)).map((charge) => `sin ${charge.label ?? charge.id}`);
  const labels = changed.concat(removed);
  if (labels.length === 0) return 'Cargos: sin cambios';
  const rest = labels.length - MAX_LABELS;
  return `Cargos: ${labels.slice(0, MAX_LABELS).join(', ')}${rest > 0 ? ` (+${rest})` : ''}`;
}

function restructureSummary(event, { applied }) {
  const parts = [];
  if (applied?.carriedMinor !== undefined) parts.push(formatMoney(applied.carriedMinor));
  const periods = event.payload.terms?.n;
  if (periods !== undefined) parts.push(plural(periods, 'cuota', 'cuotas'));
  return `Reestructuración: ${parts.join(' a ')}`;
}

function lateSummary(event) {
  const { mode, rate, multiple, graceDays = 0 } = event.payload.late;
  let policy = 'tasa de usura';
  if (mode === 'none') policy = 'sin mora';
  else if (mode === 'fixed') policy = `tasa fija ${formatEaValue(toEffectiveAnnual(rate))}`;
  else if (mode === 'contract_multiple') policy = `${formatDecimal(multiple)} veces la tasa del contrato`;
  const grace = graceDays > 0 ? ` · gracia de ${plural(graceDays, 'día', 'días')}` : '';
  return `Mora: ${policy} desde ${formatDueDate(event.effectiveOn)}${grace}`;
}

// "Corrección: día de corte 15 → 20 · pago mínimo 5 % → 3 %": each corrected field with the value it replaced (only the new one when unknown).
function correctionSummary(event) {
  const { fields, previous = {} } = event.payload;
  const parts = describeCorrection(fields, previous).map(({ label, before, after }) => {
    const name = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    return before === null ? `${name} ${after}` : `${name} ${before} → ${after}`;
  });
  return `Corrección: ${parts.join(' · ')}`;
}

const SUMMARIES = { rate_change: rateSummary, charge_change: chargesSummary, restructure: restructureSummary, late_policy: lateSummary, terms_correction: correctionSummary };

/**
 * One-line summary of a plan-change event, or null for the kinds that carry an amount.
 * @param {{ kind: string, effectiveOn: string, payload: object }} event A normalized event.
 * @param {{ applied?: object, card?: boolean, previousCharges?: object[] }} [context] `applied` is the event's entry in
 *   `projection.applied` (EA before and after, carried balance); `previousCharges` are the charges in force just before a
 *   `charge_change`; a card has no keep-term or keep-installment mode.
 * @returns {(string | null)}
 */
export function summarizeEvent(event, context = {}) {
  return SUMMARIES[event.kind]?.(event, context) ?? null;
}

const BLOCKER_LABELS = {
  payment: 'el pago',
  extra_payment: 'el abono extra',
  rate_change: 'el cambio de tasa',
  charge_change: 'el cambio de cargos',
  late_policy: 'la política de mora',
  restructure: 'la reestructuración',
  terms_correction: 'la corrección de datos',
};

/** "el pago del 5 nov y el cambio de tasa del 1 dic": the events that block a guarded void. */
export function describeBlockers(events) {
  const named = events.map((event) => `${BLOCKER_LABELS[event.kind] ?? 'el movimiento'} del ${formatDueDate(event.effectiveOn)}`);
  if (named.length < 2) return named.join('');
  return `${named.slice(0, -1).join(', ')} y ${named[named.length - 1]}`;
}
