import { useId, useMemo, useState } from 'react';
import { toEffectiveAnnual } from '@finance-core';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { cn, focusRing } from '../../shared/ui/cn';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField, labelClass } from '../../shared/ui/TextField';
import BackdatedNotice from './BackdatedNotice';
import BeforeAfterPreview from './BeforeAfterPreview';
import RateField from './RateField';
import { formatEa } from './debtLabels';
import { INSTALLMENT_TOO_LOW, KEEP_TERM_ONLY, initialRateForm, previewRateChange, rateInForce } from './rateChangeModel';
import Notices from './wizard/Notices';

const MODE_OPTIONS = [
  { value: 'keep_term', label: 'Mantener el plazo', hint: 'Recalculamos la cuota para terminar en la misma fecha.' },
  { value: 'keep_installment', label: 'Mantener la cuota', hint: 'Pagas lo mismo y el plan termina antes o después.' },
];

function Preview({ result }) {
  const { before, after, isCard } = result;
  const rows = [
    { label: isCard ? 'Pago mínimo' : 'Próxima cuota', before: formatMoney(before.installmentMinor), after: formatMoney(after.installmentMinor) },
    ...(isCard ? [] : [{ label: 'Cuotas restantes', before: before.remainingPeriods, after: after.remainingPeriods }]),
    { label: 'Intereses por pagar', before: formatMoney(before.remainingInterestMinor), after: formatMoney(after.remainingInterestMinor) },
  ];
  return (
    <BeforeAfterPreview rows={rows}>
      {result.unchanged && <p className="text-[13px] text-ink-muted">Este cambio no modifica ninguna cuota.</p>}
    </BeforeAfterPreview>
  );
}

/**
 * Rate change form: effective date, the new rate in any convention (with its EA echo and the informational usury notice),
 * keep term or keep installment, and the live before/after preview from `previewChange` (see `previewRateChange`).
 * `saveState`: `{ status, error, locked }`; `onSubmit(draft)` receives the `rate_change` draft to write.
 */
export default function RateChangeDialog({ debt, events, projection, today, saveState, onSubmit, onClose }) {
  const modeLabelId = useId();
  const [form, setForm] = useState(() => initialRateForm(projection, today));
  const result = useMemo(() => previewRateChange({ debt, events, projection, form, today }), [debt, events, projection, form, today]);
  const saving = saveState.status === 'saving';
  const primaryLabel = saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : 'Guardar cambio';
  const patchRate = (patch) => setForm((current) => ({ ...current, rate: { ...current.rate, ...patch } }));

  const submit = (event) => {
    event.preventDefault();
    if (result.draft && !saving) onSubmit(result.draft);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Cambiar tasa" description={`${debt.name}. Tasa actual: ${formatEa(toEffectiveAnnual(rateInForce(projection)))}.`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <TextField label="Vigente desde" type="date" value={form.effectiveOn} onChange={(event) => setForm({ ...form, effectiveOn: event.target.value })} disabled={saving} />
            {result.backdated && <BackdatedNotice impacted={result.impacted} />}

            <fieldset disabled={saving} className="contents">
              <RateField rate={form.rate} echo={result.echo} onChange={patchRate} />
            </fieldset>
            {result.echo.ok && result.echo.notice && <Notices notices={[result.echo.notice]} />}

            {result.modes.length > 1 && (
              <div role="radiogroup" aria-labelledby={modeLabelId} className="flex flex-col gap-2">
                <span id={modeLabelId} className={labelClass}>¿Qué se mantiene?</span>
                {MODE_OPTIONS.map((option) => (
                  <label key={option.value} className={cn('flex cursor-pointer items-start gap-3 rounded-sm border border-border-strong p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft', focusRing)}>
                    <input type="radio" name="mode" value={option.value} checked={result.mode === option.value} onChange={() => setForm({ ...form, mode: option.value })} disabled={saving} className="mt-1 accent-accent" />
                    <span className="flex flex-col gap-0.5"><b className="text-sm font-semibold text-ink">{option.label}</b><span className="text-[13px] text-ink-muted">{option.hint}</span></span>
                  </label>
                ))}
              </div>
            )}
            {result.modes.length === 1 && <p className="text-[13px] text-ink-muted">{KEEP_TERM_ONLY}</p>}
            {result.tooLow && <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] leading-5 text-shared">{INSTALLMENT_TOO_LOW}</p>}

            {result.issue && <p role="alert" className="text-sm font-medium text-danger">{result.issue}</p>}
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
