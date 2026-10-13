import { commitPlan, planCommit, serializeTerms } from '@finance-core';
import { createDebt, debtPort } from '../../appwrite';

/**
 * Writes a new loan: its `disbursement` event (exactly once through `commitPlan`: unique dedupe key)
 * and the `debts` row. Every id derives from `nonce`, so repeating the call with the same nonce
 * finishes whatever a failed attempt left undone. The event goes first on purpose: an event
 * without its debt is invisible, while a debt without its event would be listed half-created.
 * A disbursement has no cost, so no expense row is written and no income is created.
 */
export async function saveLoan({ draft, ownerScope, nonce, householdId, actorId }) {
  const { name, lender, terms } = draft;
  const id = `db${nonce}`;
  const data = {
    householdId,
    name,
    kind: terms.kind,
    ownerScope,
    ...(lender ? { lender } : {}),
    status: 'active',
    currency: terms.unit,
    principalMinor: terms.principalMinor,
    openedOn: terms.openedOn,
    termsJson: serializeTerms(terms),
    termsVersion: 1,
    actorId,
  };
  const plan = planCommit(
    { ...data, $id: id },
    [],
    { kind: 'disbursement', effectiveOn: terms.openedOn, amountMinor: terms.principalMinor },
    { eventId: `de${nonce}`, dedupeKey: `web:${nonce}:disb`, actorId, source: 'web' },
  );
  await commitPlan(debtPort(), plan);
  try {
    await createDebt({ id, data });
  } catch (error) {
    if (error?.code !== 409) throw error; // 409: an earlier attempt with the same draft already created it
  }
}
