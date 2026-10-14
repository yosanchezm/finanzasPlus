import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import BackdatedNotice from './BackdatedNotice';
import BeforeAfterPreview from './BeforeAfterPreview';
import ChargesEditor from './ChargesEditor';
import { initialChargeForm, previewChargeChange } from './chargeChangeModel';

function Preview({ result }) {
  const { before, after, isCard } = result;
  const rows = [
    { label: isCard ? 'Pago mínimo' : 'Próxima cuota con cargos', before: formatMoney(before.nextTotalMinor), after: formatMoney(after.nextTotalMinor) },
    ...(isCard ? [] : [{ label: 'Cargos por pagar', before: formatMoney(before.remainingChargesMinor), after: formatMoney(after.remainingChargesMinor) }]),
  ];
  return (
    <BeforeAfterPreview rows={rows}>
      {result.unchanged && <p className="text-[13px] text-ink-muted">Este cambio no modifica la próxima cuota ni los cargos por pagar.</p>}
    </BeforeAfterPreview>
  );
}

/**
 * Charge change form: the effective date, the charges editor over the real charges in force, and the live before/after
 * preview from `previewChange` (see `previewChargeChange`). The set left in the editor replaces the old one from the
 * effective date. `saveState`: `{ status, error, locked }`; `onSubmit(draft)` receives the `charge_change` draft to write.
 */
export default function ChargeChangeDialog({ debt, events, projection, today, saveState, onSubmit, onClose }) {
  const [form, setForm] = useState(() => initialChargeForm(projection, events, today));
  const result = useMemo(() => previewChargeChange({ debt, events, projection, form, today }), [debt, events, projection, form, today]);
  const saving = saveState.status === 'saving';
  const primaryLabel = saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : 'Guardar cambio';

  const submit = (event) => {
    event.preventDefault();
    if (result.draft && !saving) onSubmit(result.draft);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Cambiar seguros y cargos" description={`${debt.name}. Los cargos que dejes reemplazan a los actuales desde la fecha elegida.`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <TextField label="Vigente desde" type="date" value={form.effectiveOn} onChange={(event) => setForm({ ...form, effectiveOn: event.target.value })} disabled={saving} />
              <p className="text-[13px] text-ink-muted">Aplica a las cuotas que vencen después de esta fecha.</p>
            </div>
            {result.backdated && <BackdatedNotice impacted={result.impacted} />}

            <ChargesEditor rows={form.rows} onChange={(rows) => setForm((current) => ({ ...current, rows }))} disabled={saving} />

            {!result.check.ok && result.issue === null && <p role="alert" className="text-sm font-medium text-danger">Corrige los cargos señalados para ver la vista previa.</p>}
            {result.issue && <p role="alert" className="text-sm font-medium text-danger">{result.issue}</p>}
            {result.same && <p role="status" className="text-[13px] text-ink-muted">Todavía no cambiaste ningún cargo.</p>}
            {result.draft && <Preview result={result} />}
            {saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button type="submit" disabled={!result.draft || saving}><Check size={16} aria-hidden="true" />{primaryLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
