import { useId, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { cn, focusRing } from '../../shared/ui/cn';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField, labelClass } from '../../shared/ui/TextField';
import { dueNow, previewPayment } from './paymentModel';

export const STRATEGY_OPTIONS = [
  { value: 'reduce_term', label: 'Reducir plazo', hint: 'Pagas la misma cuota y terminas antes.' },
  { value: 'reduce_installment', label: 'Reducir cuota', hint: 'Mantienes el plazo y pagas menos cada mes.' },
  { value: 'advance_installments', label: 'Adelantar cuotas', hint: 'El abono cubre las próximas cuotas completas.' },
];

function Line({ label, value, strong = false }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', strong && 'border-t border-[#eef1ed] pt-2 font-semibold')}>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Payment form. The "Vista previa" split comes from `planCommit` (see `previewPayment`), so it equals what is saved.
 * `initial` prefills amount and strategy (from the simulator). `saveState`: `{ status, error, locked }`; when `locked`
 * (the event was saved but not its expense) the inputs freeze and only "Reintentar" is possible.
 */
export default function PaymentDialog({ debt, events, projection, actorId, today, initial, saveState, onSubmit, onClose }) {
  const strategyLabelId = useId();
  const [amount, setAmount] = useState(String(initial?.amountMinor ?? (dueNow(projection) || projection.balanceMinor)));
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [strategy, setStrategy] = useState(initial?.strategy ?? null);
  const result = useMemo(
    () => previewPayment({ debt, events, projection, actorId, today, amount, effectiveOn, strategy }),
    [debt, events, projection, actorId, today, amount, effectiveOn, strategy],
  );
  const saving = saveState.status === 'saving';
  const frozen = saving || saveState.locked;
  const { preview } = result;
  const verb = result.requiresStrategy ? 'abono' : 'pago';
  const primaryLabel = saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : `Registrar ${verb}`;

  const submit = (event) => {
    event.preventDefault();
    if (result.draft && !saving) onSubmit(result.draft);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Registrar pago" description={`${debt.name}. Lo que debes ahora: ${formatMoney(result.dueMinor)}.`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <TextField label="Monto del pago" type="number" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={frozen} inputClassName="tabular-nums" />
              <TextField label="Fecha del pago" type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} disabled={frozen} />
            </div>

            {result.requiresStrategy && (
              <div role="group" aria-labelledby={strategyLabelId} className="flex flex-col gap-2">
                <span id={strategyLabelId} className={labelClass}>¿Cómo aplicar el abono extra?</span>
                {STRATEGY_OPTIONS.map((option) => (
                  <label key={option.value} className={cn('flex cursor-pointer items-start gap-3 rounded-sm border border-border-strong p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft', focusRing)}>
                    <input type="radio" name="strategy" value={option.value} checked={strategy === option.value} onChange={() => setStrategy(option.value)} disabled={frozen} className="mt-1 accent-accent" />
                    <span className="flex flex-col gap-0.5"><b className="text-sm font-semibold text-ink">{option.label}</b><span className="text-[13px] text-ink-muted">{option.hint}</span></span>
                  </label>
                ))}
              </div>
            )}

            {result.issue && <p role="alert" className="text-sm font-medium text-danger">{result.issue}</p>}

            {preview && (
              <div role="group" aria-label="Vista previa" className="flex flex-col gap-3 rounded-sm bg-surface-2 p-4">
                <span className="text-[13px] font-semibold text-ink-2">Vista previa: así se registrará, aún no se guardó.</span>
                <dl className="flex flex-col gap-2 text-sm">
                  <Line label="Capital" value={formatMoney(preview.principalMinor)} />
                  <Line label="Intereses" value={formatMoney(preview.interestMinor)} />
                  <Line label="Cargos e impuestos" value={formatMoney(preview.feesMinor)} />
                  <Line label="Gasto en Costos financieros" value={formatMoney(preview.costMinor)} strong />
                  <Line label="Saldo después del pago" value={formatMoney(preview.balanceAfterMinor)} />
                  {preview.surplusMinor > 0 && <Line label="Sobrante sin aplicar" value={formatMoney(preview.surplusMinor)} />}
                </dl>
              </div>
            )}

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
