import { commitPlan, planCommit, serializeTerms } from '@finance-core';
import { createDebt, debtPort } from '../../appwrite';

/**
 * Writes a new debt: for a loan, its `disbursement` event (exactly once through `commitPlan`: unique
 * dedupe key) and then the `debts` row. Every id derives from `nonce`, so repeating the call with the
 * same nonce finishes whatever a failed attempt left undone. The event goes first on purpose: an event
 * without its debt is invisible, while a debt without its event would be listed half-created.
 * A disbursement has no cost, so no expense row is written and no income is created.
 * A card has no disbursement: its opening balance lives in the terms and the debt row is the only write.
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
  if (terms.kind !== 'card') {
    const disbursement = { kind: 'disbursement', effectiveOn: terms.openedOn, amountMinor: terms.principalMinor };
    const ctx = { eventId: `de${nonce}`, dedupeKey: `web:${nonce}:disb`, actorId, source: 'web' };
    await commitPlan(debtPort(), planCommit({ ...data, $id: id }, [], disbursement, ctx));
  }
  try {
    await createDebt({ id, data });
  } catch (error) {
    if (error?.code !== 409) throw error; // 409: an earlier attempt with the same draft already created it
  }
}
