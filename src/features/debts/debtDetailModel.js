import { activeEvents, parseTerms, project, sortEvents, validateTerms } from '@finance-core';
import { summarizeEvent } from './eventSummary';

// Payments, the card's statements and purchases, and the changes to rate, charges and late-interest policy can be voided
// from the history. A restructure is voidable only through the guarded flow; a disbursement never is.
const VOIDABLE = ['payment', 'extra_payment', 'charge', 'adjustment', 'rate_change', 'charge_change', 'late_policy', 'terms_correction'];
const GUARDED = 'restructure';
// A restructure cannot be voided once any of these sorts after it: they were computed on top of it.
const BLOCKS_RESTRUCTURE_VOID = ['payment', 'extra_payment', 'rate_change', 'charge_change', 'late_policy', 'restructure', 'terms_correction'];

const VOID_MESSAGES = {
  payment: 'Pago anulado.',
  extra_payment: 'Abono anulado.',
  rate_change: 'Cambio de tasa anulado.',
  charge_change: 'Cambio de cargos anulado.',
  restructure: 'Reestructuración anulada.',
  late_policy: 'Política de mora anulada.',
  adjustment: 'Extracto anulado.',
  charge: 'Compra anulada.',
  terms_correction: 'Corrección anulada.',
};

/** Toast shown once a void of an event of this kind was saved. */
export const voidSuccessMessage = (kind) => VOID_MESSAGES[kind] ?? 'Movimiento anulado.';

/** Events whose save or void changes the cost of other events, so the cost rows are reconciled afterwards (AD16). */
export const PLAN_CHANGE_KINDS = ['rate_change', 'charge_change', 'restructure', 'late_policy', 'terms_correction'];

/**
 * Adds to a success toast what the reconcile after a plan change did. `after` is what `useCommitDialog` hands to the message:
 * `{ value: { created, updated, removed } }`, `{ error }` when the reconcile failed (the change itself is saved), or nothing.
 */
export function withReconcileNote(message, after) {
  if (!after) return message;
  if (after.error) return `${message} No pudimos actualizar los costos financieros: se corregirán al abrir la deuda de nuevo.`;
  if (!after.value) return message; // the follow-up had nothing to reconcile for this movement
  const { created, updated, removed } = after.value;
  const rows = created + updated + removed;
  if (rows === 0) return message;
  return `${message} ${rows === 1 ? 'Se actualizó 1 fila' : `Se actualizaron ${rows} filas`} de Costos financieros.`;
}

/**
 * What the history may do with one event. `voidable` is whether a void action is offered at all;
 * a `guarded` void (restructure) asks for explicit confirmation and is refused while later events
 * exist: `voidBlocked` then lists them as `{ code: 'later_events', events: [{ id, kind, effectiveOn }] }`.
 * @param {{ id: string, kind: string }} event A normalized event.
 * @param {object[]} activeSorted The debt's non-voided events in chronological order (see `sortEvents`).
 * @returns {{ voidable: boolean, guarded: boolean, voidBlocked: ({ code: string, events: object[] } | null) }}
 */
export function voidRuleOf(event, activeSorted) {
  if (event.kind !== GUARDED) return { voidable: VOIDABLE.includes(event.kind), guarded: false, voidBlocked: null };
  const later = activeSorted.slice(activeSorted.findIndex((other) => other.id === event.id) + 1).filter((other) => BLOCKS_RESTRUCTURE_VOID.includes(other.kind));
  const events = later.map(({ id, kind, effectiveOn }) => ({ id, kind, effectiveOn }));
  return { voidable: true, guarded: true, voidBlocked: events.length > 0 ? { code: 'later_events', events } : null };
}

// The summary of each plan-change event, computed in chronological order: a charge change is read against the charges in force just before it.
function summariesOf({ debt, sorted, active, applied, isCard }) {
  const initial = debt.terms ? validateTerms(debt.terms) : parseTerms(debt.termsJson);
  let charges = initial.charges;
  const summaries = new Map();
  for (const event of sorted) {
    if (event.kind === 'void') continue;
    summaries.set(event.id, summarizeEvent(event, { applied: applied.get(event.id), card: isCard, previousCharges: charges }));
    if (!active.has(event.id)) continue;
    if (event.kind === 'charge_change') charges = event.payload.charges;
    else if (event.kind === 'restructure') charges = event.payload.terms.charges;
  }
  return summaries;
}

/**
 * Pure view model of one debt: the projection (rendered as is), the real cost over the whole
 * plan and the event history, newest first. Voided events stay in the list, flagged with their
 * reason; the `void` events themselves are folded into that flag.
 * @param {{ debt: object, events: object[], asOf: string }} input `events` are the debt's rows.
 * @throws {Error} When the stored terms cannot be projected.
 */
export function buildDebtDetail({ debt, events, asOf }) {
  const projection = project(debt, events, asOf);
  const sorted = sortEvents(events);
  const active = new Set(activeEvents(events).map((event) => event.id));
  const reasons = new Map(sorted.filter((event) => event.kind === 'void').map((event) => [event.payload.targetEventId, event.payload.reason ?? null]));
  const applied = new Map(projection.applied.map((entry) => [entry.eventId, entry]));
  const activeSorted = sorted.filter((event) => active.has(event.id));
  const summaries = summariesOf({ debt, sorted, active, applied, isCard: Boolean(projection.card) });

  const history = sorted.filter((event) => event.kind !== 'void').reverse().map((event) => {
    const voided = !active.has(event.id);
    const rule = voided ? { voidable: false, guarded: false, voidBlocked: null } : voidRuleOf(event, activeSorted);
    return {
      id: event.id,
      kind: event.kind,
      effectiveOn: event.effectiveOn,
      amountMinor: event.amountMinor,
      statedBalanceMinor: event.payload.balanceMinor ?? null,
      source: event.source,
      strategy: event.payload.strategy ?? null,
      voided,
      voidReason: voided ? reasons.get(event.id) ?? null : null,
      costMinor: applied.get(event.id)?.costMinor ?? 0,
      summary: summaries.get(event.id) ?? null,
      canVoid: rule.voidable,
      guardedVoid: rule.guarded,
      voidBlocked: rule.voidBlocked,
    };
  });

  const { totals } = projection;
  const interestMinor = totals.interestPaid + totals.remainingInterest;
  const chargesMinor = totals.chargesPaid + totals.remainingCharges;
  const taxesMinor = totals.taxesPaid + totals.remainingTaxes;
  const lateMinor = (totals.lateInterestPaid ?? 0) + (totals.remainingLateInterest ?? 0); // mora paid plus what has accrued and is still owed (a card's includes the mora billed and unpaid plus the part still accruing)
  return {
    projection,
    history,
    cost: {
      interestMinor, chargesMinor, taxesMinor, lateMinor,
      totalMinor: interestMinor + chargesMinor + taxesMinor + lateMinor,
      paidMinor: totals.interestPaid + totals.chargesPaid + totals.taxesPaid + (totals.lateInterestPaid ?? 0),
    },
  };
}
