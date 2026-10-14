import { useState } from 'react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import { formatDueDate } from './debtLabels';
import { describeBlockers } from './eventSummary';

// Noun and grammatical gender of each voidable kind ("¿Anular este pago?", "¿Anular esta reestructuración?").
const LABELS = {
  payment: { noun: 'pago' },
  extra_payment: { noun: 'abono extra' },
  charge: { noun: 'compra', feminine: true },
  adjustment: { noun: 'extracto' },
  rate_change: { noun: 'cambio de tasa' },
  charge_change: { noun: 'cambio de cargos' },
  late_policy: { noun: 'política de mora', feminine: true },
  restructure: { noun: 'reestructuración', feminine: true },
};
const PLAN_CHANGES = ['rate_change', 'charge_change', 'late_policy', 'restructure'];

function Blocked({ entry, onClose }) {
  const { noun } = LABELS[entry.kind];
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="confirm" role="alertdialog" className="gap-4 p-6">
        <div className="flex flex-col gap-2">
          <DialogTitle className="text-lg font-semibold tracking-[-0.3px]">No se puede anular la {noun}</DialogTitle>
          <DialogDescription className="text-sm leading-[22px] text-ink-muted">{entry.summary}</DialogDescription>
        </div>
        <p role="alert" className="text-sm font-medium text-danger">No se puede anular: la bloquean {describeBlockers(entry.voidBlocked.events)}.</p>
        <div className="flex justify-end">
          <DialogClose asChild><Button variant="secondary">Entendido</Button></DialogClose>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}

/**
 * Confirmation to void an event: it stays in the history as "Anulado", the balance and the plan go back to what they were
 * and the expense in "Costos financieros" of a payment is removed. Nothing is written until the user confirms.
 * A restructure is guarded: it asks for an explicit confirmation, and when later events exist (`entry.voidBlocked`) it only
 * names them and offers no way to write.
 * `saveState` is `{ status, error, locked }` as in the payment dialog; `onConfirm(reason)`.
 */
export default function VoidDialog({ entry, saveState, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  if (entry.voidBlocked) return <Blocked entry={entry} onClose={onClose} />;
  const saving = saveState.status === 'saving';
  const { noun: label, feminine = false } = LABELS[entry.kind] ?? LABELS.payment;
  const planChange = PLAN_CHANGES.includes(entry.kind);
  const guarded = Boolean(entry.guardedVoid);

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="confirm" role="alertdialog" className="gap-4 p-6">
        <div className="flex flex-col gap-2">
          <DialogTitle className="text-lg font-semibold tracking-[-0.3px]">¿Anular {feminine ? 'esta' : 'este'} {label}?</DialogTitle>
          <DialogDescription className="text-sm leading-[22px] text-ink-muted">
            {planChange
              ? `${entry.summary ?? `Se anula ${feminine ? 'la' : 'el'} ${label} del ${formatDueDate(entry.effectiveOn)}`}. `
              : `Se anula el ${label} de ${formatMoney(entry.amountMinor)} del ${formatDueDate(entry.effectiveOn)}. `}
            El saldo y el plan vuelven a como estaban antes
            {entry.costMinor > 0 ? ` y se elimina su gasto de ${formatMoney(entry.costMinor)} en Costos financieros` : ''}.
          </DialogDescription>
        </div>
        {guarded && (
          <label className="flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-accent" checked={understood} disabled={saving || saveState.locked} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>Entiendo que la deuda vuelve a las condiciones anteriores a la {label}.</span>
          </label>
        )}
        <TextField label="Motivo (opcional)" value={reason} onChange={(event) => setReason(event.target.value)} disabled={saving || saveState.locked} maxLength={120} />
        {saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild><Button variant="secondary" disabled={saving}>Cancelar</Button></DialogClose>
          <Button variant="danger" disabled={saving || (guarded && !understood)} onClick={() => onConfirm(reason.trim() || 'Anulado desde la web')}>
            {saving ? 'Anulando…' : saveState.status === 'error' ? 'Reintentar' : `Anular ${label}`}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
