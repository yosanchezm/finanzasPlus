import { useState } from 'react';
import { dateInputValue } from '../../shared/lib/dates';
import { readableError } from '../../shared/lib/errors';
import DebtDetailContainer from './DebtDetailContainer';
import DebtsView from './DebtsView';
import { buildDebtList } from './debtViewModel';
import { defaultNonce } from './nonce';
import { saveLoan } from './saveLoan';
import { useDebtData } from './useDebtData';
import DebtWizard from './wizard/DebtWizard';

const IDLE = { status: 'idle', error: null };

/**
 * Data container for the Deudas section: loads and projects debts, and owns the create handler.
 * No optimistic updates: the list only changes after the write succeeded and the data was reloaded.
 * A failed save keeps the wizard open with its inputs and its nonce, so "Reintentar" repeats the same
 * ids (idempotent); if the user edited the draft in between, it is a different debt and gets a new nonce.
 */
export default function DebtsContainer({ inScope, currentOwnerScope, scopeControl, householdId, user, onRefresh, onNotify, createNonce = defaultNonce }) {
  const data = useDebtData();
  const [creating, setCreating] = useState(null); // { nonce, signature } of the last attempt
  const [saveState, setSaveState] = useState(IDLE);
  const [openId, setOpenId] = useState(null);

  const storedScope = (scope) => (scope === 'shared' ? 'shared' : scope === 'you' ? currentOwnerScope : currentOwnerScope === 'you' ? 'partner' : 'you');

  const openCreate = () => {
    setSaveState(IDLE);
    setCreating({ nonce: createNonce(), signature: null });
  };

  const create = async (draft) => {
    const signature = JSON.stringify(draft);
    const nonce = creating.signature && creating.signature !== signature ? createNonce() : creating.nonce;
    setCreating({ nonce, signature });
    setSaveState({ status: 'saving', error: null });
    try {
      await saveLoan({ draft, ownerScope: storedScope(draft.ownerScope), nonce, householdId, actorId: user.$id });
    } catch (error) {
      const message = readableError(error);
      setSaveState({ status: 'error', error: message });
      onNotify?.(message);
      return;
    }
    await data.reload();
    Promise.resolve(onRefresh?.()).catch(() => {});
    setCreating(null);
    onNotify?.('Deuda registrada.');
  };

  const list = data.status === 'ready'
    ? buildDebtList({ debts: data.debts, events: data.events, asOf: dateInputValue(), inScope })
    : { items: [], totals: undefined };

  const openDebt = data.status === 'ready' ? data.debts.find((debt) => debt.$id === openId) : undefined;
  if (openDebt) {
    return (
      <DebtDetailContainer
        debt={openDebt}
        events={data.events}
        otherDebts={list.items.filter((item) => !item.unreadable && item.id !== openDebt.$id && item.balanceMinor > 0).map((item) => ({ id: item.id, name: item.name, eaPercent: item.eaPercent }))}
        inScope={inScope}
        reconcileCosts={data.reconcileCosts}
        reload={data.reload}
        currentOwnerScope={currentOwnerScope}
        user={user}
        onBack={() => setOpenId(null)}
        onRefresh={onRefresh}
        onNotify={onNotify}
        createNonce={createNonce}
      />
    );
  }

  return (
    <>
      <DebtsView
        status={data.status}
        items={list.items}
        totals={list.totals}
        currentOwnerScope={currentOwnerScope}
        scopeControl={scopeControl}
        onAdd={openCreate}
        onOpen={setOpenId}
        onRetry={data.retry}
      />
      {creating && <DebtWizard saveState={saveState} onSubmit={create} onClose={() => setCreating(null)} />}
    </>
  );
}
