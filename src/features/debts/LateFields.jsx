import { SelectField, TextField } from '../../shared/ui/TextField';
import RateField from './RateField';
import { LATE_MODE_HINTS, LATE_MODE_LABELS, MAX_GRACE_DAYS, MAX_MULTIPLE } from './lateModel';
import { rateEcho } from './wizard/wizardModel';

const ALL_MODES = ['none', 'usury', 'fixed', 'contract_multiple'];

/**
 * Inputs of a mora (late interest) policy: the mode, the rate or multiple the mode needs, and the grace days.
 * `draft` is a `lateModel` draft (strings), `onChange` receives a partial draft. `modes` narrows the modes on offer
 * (the wizard leaves out the multiple of the contract rate). `modality` and `asOf` feed the echo of a fixed rate;
 * `legal` is the household's resolved tables. The owner shows the validation messages.
 */
export default function LateFields({ draft, onChange, modes = ALL_MODES, modality = 'consumer', asOf, legal }) {
  const withMode = draft.mode !== 'none';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SelectField label="Interés de mora" value={draft.mode} onChange={(event) => onChange({ mode: event.target.value })}>
          {modes.map((mode) => <option key={mode} value={mode}>{LATE_MODE_LABELS[mode]}</option>)}
        </SelectField>
        <p className="text-sm text-ink-muted">{LATE_MODE_HINTS[draft.mode]}</p>
      </div>
      {draft.mode === 'fixed' && (
        <RateField valueLabel="Tasa de mora" rate={draft.rate} echo={rateEcho(draft.rate, modality, asOf, legal)} onChange={(patch) => onChange({ rate: { ...draft.rate, ...patch } })} />
      )}
      {draft.mode === 'contract_multiple' && (
        <TextField
          label="Múltiplo de la tasa del contrato" type="number" step="any" inputMode="decimal" placeholder="Ej. 1,5" inputClassName="tabular-nums"
          min={0} max={MAX_MULTIPLE} value={draft.multiple} onChange={(event) => onChange({ multiple: event.target.value })}
        />
      )}
      {withMode && (
        <TextField
          label="Días de gracia antes de cobrar mora" type="number" inputMode="numeric" inputClassName="tabular-nums"
          min={0} max={MAX_GRACE_DAYS} value={draft.graceDays} onChange={(event) => onChange({ graceDays: event.target.value })}
        />
      )}
    </div>
  );
}
