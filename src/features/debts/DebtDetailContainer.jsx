import { useEffect, useMemo, useState } from 'react';
import { dateInputValue } from '../../shared/lib/dates';
import { ChargeDialog, StatementDialog } from './CardDialogs';
import ChargeChangeDialog from './ChargeChangeDialog';
import DebtDetail from './DebtDetail';
import LatePolicyDialog from './LatePolicyDialog';
import PaymentDialog from './PaymentDialog';
import PrepaymentSimulator from './PrepaymentSimulator';
import RateChangeDialog from './RateChangeDialog';
import RestructureDialog from './RestructureDialog';
import VoidDialog from './VoidDialog';
import { findDebtEventByDedupe } from '../../appwrite';
import { loadCashflow } from './cashflow';
import { PLAN_CHANGE_KINDS, buildDebtDetail, voidSuccessMessage, withReconcileNote } from './debtDetailModel';
import { defaultNonce } from './nonce';
import { saveDebtEvent } from './saveDebtEvent';
import { useCommitDialog } from './useCommitDialog';

const REPAIR_FAILED = 'No se pudieron verificar los costos financieros de esta deuda. Puedes seguir usando esta pantalla.';

/**
 * One open debt: projects it, repairs its cost rows once on open (AD8) and owns the write dialogs.
 * `events` are all loaded events (filtered here). Nothing is shown as recorded until `reload()` brought it back.
 */
export default function DebtDetailContainer({ debt, events: allEvents, otherDebts = [], inScope, reconcileCosts, legalStatus, reload, currentOwnerScope, user, onBack, onOpenSettings, onRefresh, onNotify, createNonce = defaultNonce, today = dateInputValue() }) {
  const [repairNotice, setRepairNotice] = useState(null);
  const [simulator, setSimulator] = useState(null); // { cashflow } while the simulator is open; null = still unknown
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
    alreadySaved: 'El intento anterior ya se había registrado, así que no se guardó de nuevo. Revisa el historial y registra otro pago si hace falta.',
    findSaved: ({ nonce }) => findDebtEventByDedupe(`web:${nonce}`),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });

  // Statements and purchases are plain events (no expense row), written like a payment: same nonce, same ids on retry.
  const eventWriter = (message, alreadySaved) => ({
    ...flow,
    successMessage: () => message,
    alreadySaved,
    findSaved: ({ nonce }) => findDebtEventByDedupe(`web:${nonce}`),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });
  const statement = useCommitDialog(eventWriter('Extracto registrado.', 'El extracto ya se había registrado, así que no se guardó de nuevo.'));
  const purchase = useCommitDialog(eventWriter('Compra registrada.', 'La compra ya se había registrado, así que no se guardó de nuevo.'));
  const isCard = Boolean(detail?.projection.card);
  const canRestructure = Boolean(detail) && !isCard && detail.projection.terms.system !== 'none'; // a plan with installments to replace

  // After a plan change is saved or voided the cost of past payments can move: repair the cost rows on fresh events (AD16).
  const reconcileAfter = () => reconcileCosts(debt.$id, { fresh: true });

  const rateChange = useCommitDialog({
    ...flow,
    afterSave: reconcileAfter,
    successMessage: (_input, after) => withReconcileNote('Cambio de tasa registrado.', after),
    alreadySaved: 'El cambio de tasa ya se había registrado, así que no se guardó de nuevo. Revisa el historial.',
    findSaved: ({ nonce }) => findDebtEventByDedupe(`web:${nonce}`),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });

  const chargeChange = useCommitDialog({
    ...flow,
    afterSave: reconcileAfter,
    successMessage: (_input, after) => withReconcileNote('Cambio de cargos registrado.', after),
    alreadySaved: 'El cambio de cargos ya se había registrado, así que no se guardó de nuevo. Revisa el historial.',
    findSaved: ({ nonce }) => findDebtEventByDedupe(`web:${nonce}`),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });

  const latePolicy = useCommitDialog({
    ...flow,
    afterSave: reconcileAfter,
    successMessage: (_input, after) => withReconcileNote('Mora configurada.', after),
    alreadySaved: 'La política de mora ya se había registrado, así que no se guardó de nuevo. Revisa el historial.',
    findSaved: ({ nonce }) => findDebtEventByDedupe(`web:${nonce}`),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });

  const restructure = useCommitDialog({
    ...flow,
    afterSave: reconcileAfter,
    successMessage: (_input, after) => withReconcileNote('Reestructuración registrada.', after),
    alreadySaved: 'La reestructuración ya se había registrado, así que no se guardó de nuevo. Revisa el historial.',
    findSaved: ({ nonce }) => findDebtEventByDedupe(`web:${nonce}`),
    save: ({ input, nonce }) => saveDebtEvent({ debt, events, draft: input, nonce, actorId: user.$id, today }),
  });

  const voiding = useCommitDialog({
    ...flow,
    afterSave: ({ input }) => (PLAN_CHANGE_KINDS.includes(input.kind) ? reconcileAfter() : undefined),
    successMessage: ({ kind }, after) => withReconcileNote(voidSuccessMessage(kind), after),
    alreadySaved: 'La anulación ya se había registrado, así que no se guardó de nuevo.',
    findSaved: ({ context }) => findDebtEventByDedupe(`void:${context.id}`),
    save: ({ input, nonce, context }) => saveDebtEvent({ debt, events, draft: { kind: 'void', effectiveOn: today, targetEventId: context.id, reason: input.reason }, nonce, actorId: user.$id, today }),
  });

  // The 3-month averages load when the simulator opens; until then (or if they fail) the advice treats the cash flow as unknown.
  const openSimulator = () => {
    setSimulator({ cashflow: null });
    loadCashflow({ today, inScope }).then((cashflow) => setSimulator((current) => (current ? { cashflow } : current)));
  };

  return (
    <>
      <DebtDetail debt={debt} detail={detail} currentOwnerScope={currentOwnerScope} notice={repairNotice} legalStatus={legalStatus} onBack={onBack} onOpenSettings={onOpenSettings} onPay={detail ? () => payment.open() : undefined} onSimulate={detail ? openSimulator : undefined} onVoid={voiding.open} onStatement={isCard ? statement.open : undefined} onCharge={isCard ? purchase.open : undefined} onRateChange={detail ? () => rateChange.open() : undefined} onChargeChange={detail ? () => chargeChange.open() : undefined} onLatePolicy={detail ? () => latePolicy.open() : undefined} onRestructure={canRestructure ? () => restructure.open() : undefined} />
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
      {statement.dialog && detail && (
        <StatementDialog debt={debt} events={events} projection={detail.projection} actorId={user.$id} today={today} saveState={statement.saveState} onSubmit={statement.submit} onClose={statement.close} />
      )}
      {purchase.dialog && detail && (
        <ChargeDialog debt={debt} events={events} actorId={user.$id} today={today} saveState={purchase.saveState} onSubmit={purchase.submit} onClose={purchase.close} />
      )}
      {rateChange.dialog && detail && (
        <RateChangeDialog debt={debt} events={events} projection={detail.projection} today={today} saveState={rateChange.saveState} onSubmit={rateChange.submit} onClose={rateChange.close} />
      )}
      {chargeChange.dialog && detail && (
        <ChargeChangeDialog debt={debt} events={events} projection={detail.projection} today={today} saveState={chargeChange.saveState} onSubmit={chargeChange.submit} onClose={chargeChange.close} />
      )}
      {latePolicy.dialog && detail && (
        <LatePolicyDialog debt={debt} events={events} projection={detail.projection} today={today} saveState={latePolicy.saveState} onSubmit={latePolicy.submit} onClose={latePolicy.close} />
      )}
      {restructure.dialog && detail && (
        <RestructureDialog debt={debt} events={events} projection={detail.projection} today={today} saveState={restructure.saveState} onSubmit={restructure.submit} onClose={restructure.close} />
      )}
      {simulator && detail && (
        <PrepaymentSimulator
          debt={debt}
          events={events}
          today={today}
          otherDebts={otherDebts}
          cashflow={simulator.cashflow}
          onRecord={(initial) => { setSimulator(null); payment.open(initial); }}
          onClose={() => setSimulator(null)}
        />
      )}
      {voiding.dialog && (
        <VoidDialog entry={voiding.dialog.context} saveState={voiding.saveState} onConfirm={(reason) => voiding.submit({ reason, kind: voiding.dialog.context.kind })} onClose={voiding.close} />
      )}
    </>
  );
}
