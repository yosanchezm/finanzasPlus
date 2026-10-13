import { commitPlan, planCommit } from '@finance-core';
import { debtPort } from '../../appwrite';

/**
 * Writes one payment, extra payment or void: the event (unique by its dedupe key) and the cost
 * expense, through `planCommit` and `commitPlan`. Every id derives from `nonce`, so repeating the
 * call with the same nonce and draft finishes whatever a failed attempt left undone.
 * @param {{ debt: object, events: object[], draft: object, nonce: string, actorId: string, today: string }} input
 */
export function saveDebtEvent({ debt, events, draft, nonce, actorId, today }) {
  const plan = planCommit(debt, events, draft, {
    eventId: `${draft.kind === 'void' ? 'dv' : 'de'}${nonce}`,
    dedupeKey: `web:${nonce}`,
    actorId,
    source: 'web',
    asOf: today,
  });
  return commitPlan(debtPort(), plan);
}
