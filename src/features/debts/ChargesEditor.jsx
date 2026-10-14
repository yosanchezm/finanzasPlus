import { useId, useMemo, useRef, useState } from 'react';
import { DollarSign, Percent, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { SelectField, TextField } from '../../shared/ui/TextField';
import {
  CADENCE_OPTIONS, KIND_OPTIONS, addCustom, addPreset, availablePresets, basisOptionsFor, dependentsOf, issueOf, patchDraft, referenceOptions, removeDraft, validateCharges,
} from './chargesEditorModel';

const nameOf = (row) => row.label.trim() || 'Cargo nuevo';
const DEFAULT_OPTIONS = { cadence: 'per_installment', fromPeriod: '1', toPeriod: '' };

// «A», «A» y «B», «A», «B» y «C»
const quoted = (rows) => {
  const names = rows.map((row) => `«${nameOf(row)}»`);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
};

function FieldError({ id, message }) {
  return message ? <p id={id} className="text-[13px] font-medium text-danger">{message}</p> : null;
}

function RemovalConfirm({ row, dependents, onConfirm, onCancel }) {
  const plural = dependents.length > 1;
  return (
    <div role="group" aria-label="Confirmar que se quitan varios cargos" className="flex flex-col gap-3 rounded-sm bg-danger-soft px-3 py-2.5 text-[13px] leading-5 text-[#9a3412]">
      <p>Al quitar «{nameOf(row)}» también se {plural ? 'quitan' : 'quita'} {quoted(dependents)}, que {plural ? 'dependen' : 'depende'} de ella.</p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={onConfirm}>Quitar todo</Button>
        <Button variant="secondary" onClick={onCancel}>Conservar</Button>
      </div>
    </div>
  );
}

function ChargeRow({ row, rows, issues, disabled, asking, onPatch, onRemove, onConfirm, onCancel }) {
  const errorId = useId();
  const problem = (field) => issueOf(issues, row.id, field);
  const invalid = (field) => (problem(field) ? { 'aria-invalid': true, 'aria-describedby': `${errorId}-${field}` } : {});
  const bases = referenceOptions(rows, row.id);
  const baseValid = bases.some((option) => option.id === row.refId);
  const isFixed = row.basis === 'fixed';
  const customOptions = row.cadence !== DEFAULT_OPTIONS.cadence || row.fromPeriod !== DEFAULT_OPTIONS.fromPeriod || row.toPeriod !== DEFAULT_OPTIONS.toPeriod;
  const dependents = asking ? dependentsOf(rows, row.id) : [];
  const text = (field) => (event) => onPatch({ [field]: event.target.value });

  return (
    <li>
      <fieldset disabled={disabled} className="flex flex-col gap-3 rounded-md border border-border p-3">
        <legend className="sr-only">{nameOf(row)}</legend>
        <div className="flex items-end gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <TextField label="Nombre" value={row.label} onChange={text('label')} {...invalid('label')} />
          </div>
          <Button variant="ghost" size="icon" aria-label={`Quitar ${nameOf(row)}`} onClick={onRemove} disabled={disabled}><Trash2 size={18} aria-hidden="true" /></Button>
        </div>
        <FieldError id={`${errorId}-label`} message={problem('label')} />

        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
          <SelectField label="Tipo" value={row.kind} onChange={text('kind')}>
            {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          <SelectField label="Se calcula como" value={row.basis} onChange={text('basis')}>
            {basisOptionsFor(row).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </SelectField>
          <TextField
            label="Valor"
            type="text"
            inputMode={isFixed ? 'numeric' : 'decimal'}
            icon={isFixed ? DollarSign : Percent}
            value={row.value}
            onChange={text('value')}
            inputClassName="tabular-nums"
            {...invalid('value')}
          />
          {row.basis === 'pctOfCharge' && (
            <SelectField label="Base" value={baseValid ? row.refId : ''} onChange={text('refId')} {...invalid('refId')}>
              {!baseValid && <option value="">Elige un cargo</option>}
              {bases.map((option) => <option key={option.id} value={option.id}>{nameOf(option)}</option>)}
            </SelectField>
          )}
        </div>
        <FieldError id={`${errorId}-value`} message={problem('value')} />
        <FieldError id={`${errorId}-refId`} message={problem('refId')} />

        <details open={customOptions} className="text-sm">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Más opciones</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
            <SelectField label="Frecuencia" value={row.cadence} onChange={text('cadence')}>
              {CADENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </SelectField>
            <TextField label="Desde la cuota" type="text" inputMode="numeric" value={row.fromPeriod} onChange={text('fromPeriod')} inputClassName="tabular-nums" {...invalid('fromPeriod')} />
            <TextField label="Hasta la cuota" type="text" inputMode="numeric" value={row.toPeriod} onChange={text('toPeriod')} placeholder="Sin límite" inputClassName="tabular-nums" {...invalid('toPeriod')} />
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <FieldError id={`${errorId}-fromPeriod`} message={problem('fromPeriod')} />
            <FieldError id={`${errorId}-toPeriod`} message={problem('toPeriod')} />
          </div>
        </details>
        {asking && <RemovalConfirm row={row} dependents={dependents} onConfirm={onConfirm} onCancel={onCancel} />}
      </fieldset>
    </li>
  );
}

/**
 * Editor of a debt's real charges (insurance, fees, taxes): name, type, how each is calculated (fixed pesos, % of the
 * balance, of the original amount, of another charge or of the installment), its value and, under "Más opciones", its
 * cadence and installment range. It edits the drafts of `chargesEditorModel` (strings, like the inputs); the owner turns
 * them into real charges with `validateCharges`. Removing a charge that others are calculated on asks first and names them.
 * Props: `rows` (drafts), `onChange(nextRows)`, `disabled`.
 */
export default function ChargesEditor({ rows, onChange, disabled = false }) {
  const [asking, setAsking] = useState(null);
  const root = useRef(null);
  const { issues } = useMemo(() => validateCharges(rows), [rows]);
  const presets = availablePresets(rows);
  const pending = rows.some((row) => row.id === asking) ? asking : null;

  const commit = (next) => {
    setAsking(null);
    onChange(next);
    root.current?.focus();
  };
  const remove = (id) => (dependentsOf(rows, id).length > 0 ? setAsking(id) : commit(removeDraft(rows, id)));

  return (
    <section ref={root} tabIndex={-1} aria-label="Seguros y cargos" className="flex flex-col gap-3 outline-none">
      {rows.length === 0 ? <p className="text-sm text-ink-muted">Esta deuda no tiene seguros ni cargos.</p> : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <ChargeRow
              key={row.id}
              row={row}
              rows={rows}
              issues={issues}
              disabled={disabled}
              asking={pending === row.id}
              onPatch={(patch) => onChange(patchDraft(rows, row.id, patch))}
              onRemove={() => remove(row.id)}
              onConfirm={() => commit(removeDraft(rows, row.id))}
              onCancel={() => setAsking(null)}
            />
          ))}
        </ul>
      )}
      <div role="group" aria-label="Agregar un cargo" className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button key={preset.key} variant="secondary" disabled={disabled} onClick={() => onChange(addPreset(rows, preset.key))}><Plus size={16} aria-hidden="true" />{preset.label}</Button>
        ))}
        <Button variant="secondary" disabled={disabled} onClick={() => onChange(addCustom(rows))}><Plus size={16} aria-hidden="true" />Otro cargo</Button>
      </div>
    </section>
  );
}
