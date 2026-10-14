import { Button } from '../../shared/ui/Button';
import { TextField } from '../../shared/ui/TextField';
import { CheckField, FieldError, SaveError, saveLabel } from './FormParts';
import { toSmmlvRow, validateSmmlvDraft } from './legalRatesModel';

/**
 * Form to enter or correct the monthly minimum wage of one year. `draft` is `{ year, valueText, source, verified }`
 * and `onChange` receives a partial draft. `onSave(row)` resolves `true` when the row was saved.
 */
export default function SmmlvForm({ draft, onChange, saveState, inputRef, onSave }) {
  const check = validateSmmlvDraft(draft);
  const saving = saveState.status === 'saving';

  const submit = async (event) => {
    event.preventDefault();
    if (!check.ok || saving) return;
    if (await onSave(toSmmlvRow(draft, draft))) onChange({ valueText: '', source: '', verified: false });
  };

  return (
    <form aria-label="Registrar salario mínimo" onSubmit={submit} className="flex flex-col gap-4 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-ink">Registrar o corregir un año</h3>
      <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <TextField label="Año" inputMode="numeric" autoComplete="off" maxLength={4} value={draft.year} onChange={(event) => onChange({ year: event.target.value })} aria-invalid={Boolean(check.errors.year)} aria-describedby="smmlv-year-error" inputClassName="tabular-nums" />
          <FieldError id="smmlv-year-error">{check.errors.year}</FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <TextField label="Valor mensual (COP)" ref={inputRef} inputMode="numeric" autoComplete="off" placeholder="Ej. 1.750.905" value={draft.valueText} onChange={(event) => onChange({ valueText: event.target.value })} aria-invalid={Boolean(check.errors.value)} aria-describedby="smmlv-value-error" inputClassName="tabular-nums" />
          <FieldError id="smmlv-value-error">{check.errors.value}</FieldError>
        </div>
      </div>
      <TextField label="Fuente (opcional)" maxLength={200} placeholder="Ej. Decreto del salario mínimo" value={draft.source} onChange={(event) => onChange({ source: event.target.value })} />
      <CheckField label="Verificado" hint="Márcalo si el valor viene de una fuente oficial." checked={draft.verified} onChange={(verified) => onChange({ verified })} />
      <SaveError saveState={saveState} />
      <Button type="submit" size="lg" disabled={!check.ok || saving} className="self-start">{saveLabel(saveState, 'Guardar salario mínimo')}</Button>
    </form>
  );
}
