import { LEGAL_MODALITIES } from '@finance-core';
import { Button } from '../../shared/ui/Button';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { SelectField, TextField } from '../../shared/ui/TextField';
import { CheckField, FieldError, SaveError, saveLabel } from './FormParts';
import { existingEntry, isPastMonth, modalityLabel, toRateRow, validateRateDraft } from './legalRatesModel';

const KIND_OPTIONS = [{ value: 'ibc', label: 'IBC' }, { value: 'usury', label: 'Usura' }];
const MANUAL_WINS = 'Ya hay una usura manual para este mes: manda sobre el IBC.';
const REPLACES = 'Ya hay una tasa guardada para este mes: al guardar se reemplaza.';
const PAST_MONTH = 'Estás editando un mes pasado. Los costos de mora ya calculados pueden cambiar: se recalculan al abrir cada deuda.';

/** Which stored row, if any, this draft will touch; null when only the app value exists for that month. */
function existingNote(legal, draft, kind) {
  const existing = existingEntry(legal, draft.modality, draft.month);
  if (!existing || existing.origin === 'default') return null;
  return existing.origin === 'override' && kind === 'ibc' ? MANUAL_WINS : REPLACES;
}

/**
 * Form to enter or correct one monthly IBC or usury cap. `draft` is `{ kind, modality, month, valueText, source, verified }`;
 * `onChange` receives a partial draft. The member types "19,49"; an IBC echoes the derived usury before anything is saved.
 * A mortgage has no IBC toggle: its usury is always written. `onSave(row)` resolves `true` when the row was saved.
 */
export default function RateForm({ draft, onChange, legal, today, saveState, inputRef, onSave }) {
  const mortgage = draft.modality === 'mortgage';
  const kind = mortgage ? 'usury' : draft.kind;
  const effective = { ...draft, kind };
  const check = validateRateDraft(effective);
  const saving = saveState.status === 'saving';
  const note = existingNote(legal, draft, kind);

  const submit = async (event) => {
    event.preventDefault();
    if (!check.ok || saving) return;
    if (await onSave(toRateRow(effective, draft))) onChange({ valueText: '', source: '', verified: false });
  };

  return (
    <form aria-label="Registrar tasa legal" onSubmit={submit} className="flex flex-col gap-4 border-t border-border pt-5">
      <h3 className="text-sm font-semibold text-ink">Registrar o corregir una tasa</h3>
      <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        <SelectField label="Modalidad" value={draft.modality} onChange={(event) => onChange({ modality: event.target.value })}>
          {LEGAL_MODALITIES.map((modality) => <option key={modality} value={modality}>{modalityLabel(modality)}</option>)}
        </SelectField>
        <div className="flex flex-col gap-1.5">
          <TextField label="Mes" type="month" value={draft.month} onChange={(event) => onChange({ month: event.target.value })} aria-invalid={Boolean(check.errors.month)} aria-describedby="rate-month-error" />
          <FieldError id="rate-month-error">{check.errors.month}</FieldError>
        </div>
      </div>

      {mortgage ? (
        <p className="text-sm text-ink-muted">Hipotecario: la usura se escribe, no se deriva del IBC.</p>
      ) : (
        <SegmentedControl label="Tipo de tasa" options={KIND_OPTIONS} value={kind} onChange={(value) => onChange({ kind: value })} />
      )}

      <div className="flex flex-col gap-1.5">
        <TextField
          label={kind === 'ibc' ? 'IBC bancario corriente (% E.A.)' : 'Usura (% E.A.)'}
          ref={inputRef}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 19,49"
          value={draft.valueText}
          onChange={(event) => onChange({ valueText: event.target.value })}
          aria-invalid={Boolean(check.errors.value)}
          aria-describedby="rate-value-error"
          inputClassName="tabular-nums"
        />
        <FieldError id="rate-value-error">{check.errors.value}</FieldError>
        {check.usuryLabel && (
          <p aria-live="polite" className="text-sm text-ink-muted">
            <b className="font-semibold text-ink tabular-nums">{`Usura = ${check.usuryLabel} % E.A.`}</b>
            {' '}(1,5 × el IBC, redondeado).
          </p>
        )}
      </div>

      {isPastMonth(draft.month, today) && <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared">{PAST_MONTH}</p>}
      {note && <p role="status" className="text-[13px] text-ink-muted">{note}</p>}

      <TextField label="Fuente (opcional)" maxLength={200} placeholder="Ej. Resolución de la Superfinanciera" value={draft.source} onChange={(event) => onChange({ source: event.target.value })} />
      <CheckField label="Verificado" hint="Márcalo si la tasa viene de una fuente oficial." checked={draft.verified} onChange={(verified) => onChange({ verified })} />

      <SaveError saveState={saveState} />
      <Button type="submit" size="lg" disabled={!check.ok || saving} className="self-start">{saveLabel(saveState, 'Guardar tasa')}</Button>
    </form>
  );
}
