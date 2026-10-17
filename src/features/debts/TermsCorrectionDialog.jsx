import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { SelectField, TextField } from '../../shared/ui/TextField';
import BackdatedNotice from './BackdatedNotice';
import BeforeAfterPreview from './BeforeAfterPreview';
import RateField from './RateField';
import { MODALITY_LABELS, NO_CHANGE, RETROACTIVE_NOTE, initialCorrectionForm, previewCorrection } from './termsCorrectionModel';
import { MIN_RULES } from './wizard/wizardModel';
import Notices from './wizard/Notices';

const money = { type: 'number', inputMode: 'numeric', placeholder: '$ 0', inputClassName: 'tabular-nums' };

function CardFields({ card, onChange }) {
  const bind = (key) => ({ value: card[key], onChange: (event) => onChange({ [key]: event.target.value }) });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <TextField label="Día de corte" type="number" inputMode="numeric" inputClassName="tabular-nums" {...bind('statementDay')} />
        <TextField label="Día límite de pago" type="number" inputMode="numeric" inputClassName="tabular-nums" {...bind('dueDay')} />
      </div>
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <TextField label="Fecha del último corte" type="date" {...bind('lastStatementOn')} />
        <TextField label="Pago mínimo del extracto (opcional)" {...money} {...bind('openingMinimum')} />
      </div>
      <SelectField label="Cómo se calcula tu pago mínimo" {...bind('minRule')}>
        {MIN_RULES.map((rule) => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
      </SelectField>
      {card.minRule !== 'installments_due' && (
        <TextField label="Porcentaje del pago mínimo (%)" type="number" step="any" inputMode="decimal" inputClassName="tabular-nums" {...bind('minPct')} />
      )}
      <TextField label="Pago mínimo de al menos (opcional)" {...money} {...bind('minFloor')} />
    </div>
  );
}

/**
 * "Corregir datos": fixes data that was wrong from the start (rate and its convention, modality and, for a card, the cut
 * and due days, the last statement it was registered from with its minimum, and the minimum payment) by writing a `terms_correction`. The fields start on the stored values; the preview
 * is the core's `previewChange` (see `previewCorrection`). `saveState`: `{ status, error, locked }`; `onSubmit(draft)` receives
 * the `terms_correction` draft to write.
 */
export default function TermsCorrectionDialog({ debt, events, today, saveState, onSubmit, onClose }) {
  const [form, setForm] = useState(() => initialCorrectionForm(debt, events, today));
  const result = useMemo(() => previewCorrection({ debt, events, form, today }), [debt, events, form, today]);
  const saving = saveState.status === 'saving';
  const primaryLabel = saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : 'Guardar corrección';
  const patchRate = (patch) => setForm((current) => ({ ...current, rate: { ...current.rate, ...patch } }));
  const patchCard = (patch) => setForm((current) => ({ ...current, card: { ...current.card, ...patch } }));

  const submit = (event) => {
    event.preventDefault();
    if (result.draft && !saving) onSubmit(result.draft);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Corregir datos" description={`${debt.name}. Corrige un dato que quedó mal desde el inicio.`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <p className="text-[13px] leading-5 text-ink-muted">{RETROACTIVE_NOTE}</p>

            <fieldset disabled={saving} className="contents">
              <RateField rate={form.rate} echo={result.echo} onChange={patchRate} />
              <SelectField label="Modalidad" value={form.modality} onChange={(event) => setForm({ ...form, modality: event.target.value })}>
                {Object.entries(MODALITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </SelectField>
              {result.isCard && <CardFields card={form.card} onChange={patchCard} />}
            </fieldset>
            {result.echo.ok && result.echo.notice && <Notices notices={[result.echo.notice]} />}

            {result.noChange && <p role="status" className="text-[13px] text-ink-muted">{NO_CHANGE}</p>}
            {result.issue && !result.noChange && <p role="alert" className="text-sm font-medium text-danger">{result.issue}</p>}
            {result.warning && <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] leading-5 text-shared">{result.warning}</p>}
            {result.draft && <BeforeAfterPreview rows={result.rows} />}
            {result.impacted.length > 0 && (
              <BackdatedNotice
                impacted={result.impacted}
                title="Pagos ya registrados que cambian de costo"
                intro="Con los datos corregidos, el costo financiero de estos pagos cambia. Al guardar, actualizamos Costos financieros."
              />
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
