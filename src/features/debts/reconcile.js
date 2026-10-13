import { activeEvents, buildCostRow, project } from '@finance-core';

const COST_ROW_PREFIX = 'dc';

/**
 * Diffs the cost rows a debt should have against the ones it has (AD8). Pure.
 * Expected: one `dc{eventId}` expense per active payment whose allocation has a cost, with the
 * amount the projection computes now. A backdated payment or a void can move that amount, or
 * remove the payment altogether, so existing rows are compared by value, not only by presence.
 * Only rows the debt module wrote (`source: 'debt'`, id `dc…`) can be changed or deleted.
 * @param {object} debt A `debts` row.
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {object[]} costRows The `transactions` rows whose `debtId` is the debt.
 * @returns {{ create: { id: string, data: object }[], update: { id: string, data: { amountMinor: number } }[], remove: string[] }}
 *   Created rows have `categoryId: null`; the executor fills it.
 */
export function planReconcile(debt, events, costRows) {
  const active = activeEvents(events);
  const horizon = active.reduce((latest, event) => (event.effectiveOn > latest ? event.effectiveOn : latest), '');
  const expected = new Map();
  if (horizon) {
    for (const entry of project(debt, events, horizon).applied) {
      const event = active.find((candidate) => candidate.id === entry.eventId);
      if (entry.costMinor > 0 && event) expected.set(`${COST_ROW_PREFIX}${entry.eventId}`, { event, costMinor: entry.costMinor });
    }
  }

  const ours = costRows.filter((row) => row.source === 'debt' && String(row.$id).startsWith(COST_ROW_PREFIX));
  const existing = new Map(ours.map((row) => [row.$id, row]));
  const plan = { create: [], update: [], remove: [] };
  for (const [id, { event, costMinor }] of expected) {
    const row = existing.get(id);
    if (!row) plan.create.push(buildCostRow(debt, event, costMinor));
    else if (Number(row.amountMinor) !== costMinor) plan.update.push({ id, data: { amountMinor: costMinor } });
  }
  for (const row of ours) if (!expected.has(row.$id)) plan.remove.push(row.$id);
  return plan;
}
