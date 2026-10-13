import { useEffect, useMemo, useState } from 'react';
import { dateInputValue } from '../../shared/lib/dates';
import DebtDetail from './DebtDetail';
import PaymentDialog from './PaymentDialog';
import { buildDebtDetail } from './debtDetailModel';
import { defaultNonce } from './nonce';
import { saveDebtEvent } from './saveDebtEvent';
import { useCommitDialog } from './useCommitDialog';

const REPAIR_FAILED = 'No se pudieron verificar los costos financieros de esta deuda. Puedes seguir usando esta pantalla.';

/**
 * One open debt: projects it, repairs its cost rows once on open (AD8) and owns the write dialogs.
 * `events` are all loaded events (filtered here). Nothing is shown as recorded until `reload()` brought it back.
 */
export default function DebtDetailContainer({ debt, events: allEvents, reconcileCosts, reload, currentOwnerScope, user, onBack, onRefresh, onNotify, createNonce = defaultNonce, today = dateInputValue() }) {
  const [repairNotice, setRepairNotice] = useState(null);
  const events = useMemo(() => allEvents.filter((event) => event.debtId === debt.$id), [allEvents, debt.$id]);
  const detail = useMemo(() => {
    try {
      return buildDebtDetail({ debt, events, asOf: today });
    } catch {
      return null; // unreadable terms: the detail says so instead of showing guesses
    }
  }, [debt, events, today]);

  useEffect(() => {
    let cancelled = false;
    setRepairNotice(null);
    reconcileCosts(debt.$id).then((result) => {
      if (cancelled || result.created + result.updated + result.removed === 0) return;
      onNotify?.('Se actualizaron los costos financieros de esta deuda.');
      Promise.resolve(onRefresh?.()).catch(() => {});
    }).catch(() => {
      if (!cancelled) setRepairNotice(REPAIR_FAILED);
    });
    return () => { cancelled = true; };
  }, [debt.$id]);

  const flow = { createNonce, reload, onRefresh, onNotify };
  const payment = useCommitDialog({
    ...flow,
    successMessage: (draft) => (draft.kind === 'extra_payment' ? 'Abono registrado.' : 'Pago registrado.'),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });

  return (
    <>
      <DebtDetail debt={debt} detail={detail} currentOwnerScope={currentOwnerScope} notice={repairNotice} onBack={onBack} onPay={detail ? () => payment.open() : undefined} />
      {payment.dialog && detail && (
        <PaymentDialog
          debt={debt}
          events={events}
          projection={detail.projection}
          actorId={user.$id}
          today={today}
          initial={payment.dialog.context}
          saveState={payment.saveState}
          onSubmit={payment.submit}
          onClose={payment.close}
        />
      )}
    </>
  );
}
