import { project, toEffectiveAnnual } from '@finance-core';

const isListed = (debt) => debt.status !== 'archived';

function describeDebt(debt, events, asOf) {
  const base = { id: debt.$id, debt, name: debt.name, lender: debt.lender || '', kind: debt.kind, ownerScope: debt.ownerScope, status: debt.status };
  try {
    const projection = project(debt, events, asOf);
    const { nextDue } = projection;
    const principal = Number(debt.principalMinor) || 0;
    return {
      ...base,
      balanceMinor: projection.balanceMinor,
      pastDueMinor: projection.pastDueMinor,
      remainingPeriods: projection.remainingPeriods,
      nextDue: nextDue ? { dueOn: nextDue.dueOn, amountMinor: nextDue.outstandingMinor, status: nextDue.status } : null,
      progressPercent: principal > 0 ? Math.max(0, Math.min(100, ((principal - projection.balanceMinor) / principal) * 100)) : 0,
      eaPercent: toEffectiveAnnual(projection.terms.rate),
    };
  } catch {
    // Corrupt or unsupported terms: keep the debt visible, but never count it in the totals.
    return { ...base, unreadable: true };
  }
}

/**
 * Pure view model of the Deudas list. Projects every listed debt as of `asOf` from its stored
 * events (never month-scoped), applies the scope filter and totals the readable ones.
 * @param {{ debts: object[], events: object[], asOf: string, inScope?: (debt: object) => boolean }} input
 */
export function buildDebtList({ debts, events, asOf, inScope = () => true }) {
  const eventsByDebt = new Map();
  for (const event of events) eventsByDebt.set(event.debtId, [...(eventsByDebt.get(event.debtId) || []), event]);

  const items = debts.filter(isListed).filter(inScope).map((debt) => describeDebt(debt, eventsByDebt.get(debt.$id) || [], asOf));
  const readable = items.filter((item) => !item.unreadable);
  const dueDates = readable.map((item) => item.nextDue?.dueOn).filter(Boolean).sort();
  return {
    items,
    totals: {
      count: readable.length,
      balanceMinor: readable.reduce((sum, item) => sum + item.balanceMinor, 0),
      installmentsMinor: readable.reduce((sum, item) => sum + (item.nextDue?.amountMinor || 0), 0),
      nextDueOn: dueDates[0] ?? null,
    },
  };
}
