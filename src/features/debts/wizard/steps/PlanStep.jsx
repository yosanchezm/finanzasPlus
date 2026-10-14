import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../shared/ui/Button';
import { SelectField, TextField } from '../../../../shared/ui/TextField';
import { PERIODICITY_ADJECTIVES, SYSTEMS_BY_KIND, SYSTEM_LABELS, firstDueOf } from '../wizardModel';

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function ManualRows({ rows, set }) {
  const update = (index, patch) => set({ manualPlan: rows.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <TextField className="flex-1" label={`Fecha de la cuota ${index + 1}`} type="date" value={row.dueOn} onChange={(event) => update(index, { dueOn: event.target.value })} />
          <TextField className="flex-1" label={`Valor de la cuota ${index + 1}`} type="number" inputMode="numeric" placeholder="$ 0" inputClassName="tabular-nums" value={row.amount} onChange={(event) => update(index, { amount: event.target.value })} />
          <Button variant="ghost" size="icon" aria-label={`Quitar cuota ${index + 1}`} onClick={() => set({ manualPlan: rows.filter((_, at) => at !== index) })} className="mb-0.5 lg:mb-0">
            <Trash2 size={18} aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => set({ manualPlan: [...rows, { dueOn: '', amount: '' }] })} className="self-start">
        <Plus size={16} aria-hidden="true" />Agregar cuota
      </Button>
    </div>
  );
}

// `systems` narrows the payment systems on offer (the restructure dialog leaves out the manual plan); by default the kind's own.
// `invalid` marks the fields (n, firstDueOn, grace, balloon) the owner found wrong; the owner shows the messages.
export default function PlanStep({ state, set, systems = SYSTEMS_BY_KIND[state.kind], invalid = {} }) {
  const graced = ['french', 'german'].includes(state.system);
  const flag = (field) => (invalid[field] ? { 'aria-invalid': true } : {});
  const bind = (field) => ({ value: state[field], onChange: (event) => set({ [field]: event.target.value }), ...flag(field) });

  return (
    <div className="flex flex-col gap-4">
      {systems.length > 1 && (
        <SelectField label="Sistema de pago" {...bind('system')}>
          {systems.map((system) => <option key={system} value={system}>{SYSTEM_LABELS[system]}</option>)}
        </SelectField>
      )}
      {state.system === 'manual' ? <ManualRows rows={state.manualPlan} set={set} /> : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <TextField label="Número de cuotas" type="number" inputMode="numeric" inputClassName="tabular-nums" {...bind('n')} />
            <SelectField label="Periodicidad" {...bind('periodicity')}>
              {Object.entries(PERIODICITY_ADJECTIVES).map(([value, label]) => <option key={value} value={value}>{capitalize(label)}</option>)}
            </SelectField>
          </div>
          <TextField label="Primera cuota" type="date" value={firstDueOf(state)} onChange={(event) => set({ firstDueOn: event.target.value })} {...flag('firstDueOn')} />
          {state.system === 'interest_only' && (
            <TextField label="Pago final" type="number" inputMode="numeric" placeholder="$ 0" inputClassName="tabular-nums" {...bind('balloon')} />
          )}
          {graced && (
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <TextField label="Cuotas de gracia" type="number" inputMode="numeric" inputClassName="tabular-nums" value={state.grace.periods} onChange={(event) => set({ grace: { ...state.grace, periods: event.target.value } })} {...flag('grace')} />
              <SelectField label="Durante la gracia" value={state.grace.type} onChange={(event) => set({ grace: { ...state.grace, type: event.target.value } })}>
                <option value="total">No pagas nada</option>
                <option value="principal">Pagas solo intereses</option>
              </SelectField>
            </div>
          )}
        </>
      )}
    </div>
  );
}
