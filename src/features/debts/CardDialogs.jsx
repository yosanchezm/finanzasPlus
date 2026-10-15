import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { SelectField, TextField } from '../../shared/ui/TextField';
import { previewCharge, previewStatement } from './cardModel';

const money = { type: 'number', inputMode: 'numeric', placeholder: '$ 0', inputClassName: 'tabular-nums' };

function Line({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Shared frame of the card forms: header, fields, the "Vista previa" and the save button. `saveState` is
 * `{ status, error, locked }` as in the payment dialog; a failed save keeps everything and offers "Reintentar".
 */
function CardDialog({ title, description, submitLabel, result, lines, saveState, onSubmit, onClose, children }) {
  const saving = saveState.status === 'saving';
  const submit = (event) => {
    event.preventDefault();
    if (result.draft && !saving) onSubmit(result.draft);
  };
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={title} description={description} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <fieldset disabled={saving || saveState.locked} className="flex flex-col gap-4">{children}</fieldset>
            {result.issue && <p role="alert" className="text-sm font-medium text-danger">{result.issue}</p>}
            {result.preview && (
              <div role="group" aria-label="Vista previa" className="flex flex-col gap-3 rounded-sm bg-surface-2 p-4">
                <span className="text-[13px] font-semibold text-ink-2">Vista previa: así quedará, aún no se guardó.</span>
                <dl className="flex flex-col gap-2 text-sm">{lines.map(([label, value]) => <Line key={label} label={label} value={formatMoney(value)} />)}</dl>
              </div>
            )}
            {saveState.status === 'error' && <p role="alert" className="text-sm font-medium text-danger">{saveState.error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button type="submit" disabled={!result.draft || saving}>
              <Check size={16} aria-hidden="true" />{saving ? 'Guardando…' : saveState.status === 'error' ? 'Reintentar' : submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}

/** Records what the bank's statement says: the cut-off date, the total to pay and, optionally, its minimum payment. */
export function StatementDialog({ debt, events, projection, actorId, today, saveState, onSubmit, onClose }) {
  const last = projection.plan.length > 0 ? projection.plan[projection.plan.length - 1] : null;
  const [effectiveOn, setEffectiveOn] = useState(last ? last.statementOn : today);
  const [balance, setBalance] = useState('');
  const [minimum, setMinimum] = useState('');
  const [lateInterest, setLateInterest] = useState('');
  const result = useMemo(
    () => previewStatement({ debt, events, actorId, today, effectiveOn, balance, minimum, lateInterest }),
    [debt, events, actorId, today, effectiveOn, balance, minimum, lateInterest],
  );
  return (
    <CardDialog
      title="Registrar extracto"
      description={`${debt.name}. Copia los valores del extracto del banco para ajustar tu saldo.`}
      submitLabel="Registrar extracto"
      result={result}
      lines={[['Saldo que calculamos', result.preview?.computedMinor], ['Diferencia', result.preview?.driftMinor], ['Saldo después del extracto', result.preview?.balanceAfterMinor]]}
      saveState={saveState}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <TextField label="Fecha del extracto" type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} />
      <TextField label="Saldo total del extracto" {...money} value={balance} onChange={(event) => setBalance(event.target.value)} />
      <TextField label="Pago mínimo del extracto (opcional)" {...money} value={minimum} onChange={(event) => setMinimum(event.target.value)} />
      <TextField label="Mora del extracto (opcional)" {...money} value={lateInterest} onChange={(event) => setLateInterest(event.target.value)} />
    </CardDialog>
  );
}

const TYPES = [['revolving', 'Compra del mes'], ['deferred', 'Compra a cuotas'], ['advance', 'Avance en efectivo']];

/** Records a purchase on the card: the balance only changes through this form or a statement, never through ordinary expenses. */
export function ChargeDialog({ debt, events, actorId, today, saveState, onSubmit, onClose }) {
  const [form, setForm] = useState({ effectiveOn: today, type: 'revolving', label: '', amount: '', n: '', rate: '' });
  const result = useMemo(() => previewCharge({ debt, events, actorId, today, ...form }), [debt, events, actorId, today, form]);
  const bind = (key) => ({ value: form[key], onChange: (event) => setForm({ ...form, [key]: event.target.value }) });
  return (
    <CardDialog
      title="Registrar compra"
      description={`${debt.name}. Una compra a cuotas conserva su propia tasa aunque la tasa de la tarjeta cambie.`}
      submitLabel="Registrar compra"
      result={result}
      lines={[['Saldo después de la compra', result.preview?.balanceAfterMinor]]}
      saveState={saveState}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <SelectField label="Tipo de compra" {...bind('type')}>
        {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </SelectField>
      <TextField label="Descripción" placeholder="Ej. Portátil" {...bind('label')} />
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <TextField label="Valor" {...money} {...bind('amount')} />
        <TextField label="Fecha" type="date" {...bind('effectiveOn')} />
      </div>
      {form.type === 'deferred' && <TextField label="Cuotas" type="number" inputMode="numeric" inputClassName="tabular-nums" {...bind('n')} />}
      {form.type !== 'revolving' && (
        <TextField label="Tasa E.A. (%)" type="number" step="any" inputMode="decimal" placeholder="La de la tarjeta" inputClassName="tabular-nums" {...bind('rate')} />
      )}
    </CardDialog>
  );
}
