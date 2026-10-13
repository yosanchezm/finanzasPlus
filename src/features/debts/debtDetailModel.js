import { activeEvents, project, sortEvents } from '@finance-core';

// Payments and the card's statements and purchases can be voided from the history (the other kinds change the plan).
const VOIDABLE = ['payment', 'extra_payment', 'charge', 'adjustment'];

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

  const history = sorted.filter((event) => event.kind !== 'void').reverse().map((event) => {
    const voided = !active.has(event.id);
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
      canVoid: !voided && VOIDABLE.includes(event.kind),
    };
  });

  const { totals } = projection;
  const interestMinor = totals.interestPaid + totals.remainingInterest;
  const chargesMinor = totals.chargesPaid + totals.remainingCharges;
  const taxesMinor = totals.taxesPaid + totals.remainingTaxes;
  return {
    projection,
    history,
    cost: { interestMinor, chargesMinor, taxesMinor, totalMinor: interestMinor + chargesMinor + taxesMinor, paidMinor: totals.interestPaid + totals.chargesPaid + totals.taxesPaid },
  };
}
