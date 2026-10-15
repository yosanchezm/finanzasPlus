import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import BackdatedNotice from './BackdatedNotice';
import BeforeAfterPreview from './BeforeAfterPreview';
import LateFields from './LateFields';
import LateNotices from './LateNotices';
import { formatDecimal, formatDueDate, formatEa } from './debtLabels';
import { describeLate, initialLateForm, previewLatePolicy } from './latePolicyModel';
import { usuryModality } from './wizard/wizardModel';

const rateText = (ea) => (ea === null ? 'Sin mora' : formatEa(ea));

function Preview({ result, today, isCard }) {
  const { before, after, rates, capEA, asOf } = result;
  const rows = [
    { label: 'Tasa de mora', before: rateText(rates.before), after: rateText(rates.after) },
    { label: 'Mora acumulada', before: formatMoney(before.lateInterestMinor), after: formatMoney(after.lateInterestMinor) },
    { label: isCard ? 'Mínimo vencido' : 'Total vencido', before: formatMoney(before.pastDueMinor), after: formatMoney(after.pastDueMinor) },
  ];
  return (
    <BeforeAfterPreview rows={rows}>
      {asOf !== today && <p className="text-[13px] text-ink-muted">Cifras al {formatDueDate(asOf)}, cuando empieza la política.</p>}
      <p className="text-[13px] text-ink-muted">{capEA === null ? 'No hay un tope de usura registrado para esta fecha.' : `Tope de usura vigente: ${formatDecimal(capEA)} % E.A.`}</p>
    </BeforeAfterPreview>
  );
}

/**
 * "Configurar mora" form: effective date, the policy (none, usury, fixed rate or a multiple of the contract rate, with
 * grace days) and the live before/after preview of the mora as of today from `previewChange` (see `previewLatePolicy`).
 * Mora accrues from the day after the effective date. `saveState`: `{ status, error, locked }`; `onSubmit(draft)` receives
 * the `late_policy` draft to write.
 */
export default function LatePolicyDialog({ debt, events, projection, today, saveState, onSubmit, onClose }) {
  const [form, setForm] = useState(() => initialLateForm(projection, today));
  const result = useMemo(() => previewLatePolicy({ debt, events, projection, form, today }), [debt, events, projection, form, today]);
  const saving = saveState.status === 'saving';
  const primaryLabel = saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : 'Guardar mora';
  const canSave = Boolean(result.draft) && !result.unchanged;
  const isCard = Boolean(projection.card);

  const submit = (event) => {
    event.preventDefault();
    if (canSave && !saving) onSubmit(result.draft);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Configurar mora" description={`${debt.name}. Mora actual: ${describeLate(projection.terms.late)}.`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="flex flex-col gap-1.5">
              <TextField label="Vigente desde" type="date" value={form.effectiveOn} onChange={(event) => setForm({ ...form, effectiveOn: event.target.value })} disabled={saving} />
              <p className="text-[13px] text-ink-muted">La mora se cobra desde el día siguiente a esta fecha.</p>
            </div>
            {isCard && <p className="text-[13px] text-ink-muted">En una tarjeta la mora se cobra sobre el capital del pago mínimo que no pagaste a tiempo, desde el día siguiente al límite de pago, y aparece en el siguiente extracto.</p>}
            {result.backdated && <BackdatedNotice impacted={result.impacted} />}

            <fieldset disabled={saving} className="contents">
              <LateFields
                draft={form.late} modality={usuryModality(projection.terms.kind)} asOf={form.effectiveOn} legal={debt.legal}
                onChange={(patch) => setForm((current) => ({ ...current, late: { ...current.late, ...patch } }))}
              />
            </fieldset>
            <LateNotices notices={result.notices} />

            {result.issue && <p role="alert" className="text-sm font-medium text-danger">{result.issue}</p>}
            {result.draft && <Preview result={result} today={today} isCard={isCard} />}
            {result.unchanged && <p className="text-[13px] text-ink-muted">Esta política ya está vigente: guardar no cambia la mora.</p>}
            {saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button type="submit" disabled={!canSave || saving}><Check size={16} aria-hidden="true" />{primaryLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
