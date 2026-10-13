import { useState } from 'react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import { formatDueDate } from './debtLabels';

/**
 * Confirmation to void a payment: it stays in the history as "Anulado", the balance goes back to what it was
 * and its expense in "Costos financieros" is removed. Nothing is written until the user confirms.
 * `saveState` is `{ status, error, locked }` as in the payment dialog; `onConfirm(reason)`.
 */
export default function VoidDialog({ entry, saveState, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const saving = saveState.status === 'saving';
  const label = entry.kind === 'extra_payment' ? 'abono extra' : 'pago';

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="confirm" role="alertdialog" className="gap-4 p-6">
        <div className="flex flex-col gap-2">
          <DialogTitle className="text-lg font-semibold tracking-[-0.3px]">¿Anular este {label}?</DialogTitle>
          <DialogDescription className="text-sm leading-[22px] text-ink-muted">
            Se anula el {label} de {formatMoney(entry.amountMinor)} del {formatDueDate(entry.effectiveOn)}. El saldo y el plan vuelven a como estaban antes
            {entry.costMinor > 0 ? ` y se elimina su gasto de ${formatMoney(entry.costMinor)} en Costos financieros` : ''}.
          </DialogDescription>
        </div>
        <TextField label="Motivo (opcional)" value={reason} onChange={(event) => setReason(event.target.value)} disabled={saving || saveState.locked} maxLength={120} />
        {saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild><Button variant="secondary" disabled={saving}>Cancelar</Button></DialogClose>
          <Button variant="danger" disabled={saving} onClick={() => onConfirm(reason.trim() || 'Anulado desde la web')}>
            {saving ? 'Anulando…' : saveState.status === 'error' ? 'Reintentar' : `Anular ${label}`}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
