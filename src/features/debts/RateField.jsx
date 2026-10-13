import { useState } from 'react';
import { CONVENTIONS } from '@finance-core';
import { SelectField, TextField } from '../../shared/ui/TextField';
import { PERIODICITY_ADJECTIVES, conventionOf } from './wizard/wizardModel';

const CONVENTION_OPTIONS = [
  ['EA', 'E.A.: efectiva anual'],
  ['NAMV', 'N.M.V.: nominal mensual vencida'],
  ['MV', 'M.V.: mensual vencida'],
  ['NATV', 'N.T.V.: nominal trimestral vencida'],
  ['NATA', 'N.T.A.: nominal trimestral anticipada'],
  ['NAMA', 'N.M.A.: nominal mensual anticipada'],
  ['custom', 'Otra convención'],
];
const PERIODS = ['annual', 'semiannual', 'quarterly', 'bimonthly', 'monthly'];
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Rate entry in any convention: the value as the lender states it plus basis, periodicity and
 * timing, with a live echo of its EA equivalent. `rate` holds strings (the inputs' values),
 * `echo` is `rateEcho(...)`, and `onChange` receives a partial rate.
 */
export default function RateField({ rate, echo, onChange }) {
  const named = conventionOf(rate);
  const [custom, setCustom] = useState(named === 'custom');
  const showCustom = custom || named === 'custom';

  const pickConvention = (name) => {
    setCustom(name === 'custom');
    if (name !== 'custom') onChange({ basis: CONVENTIONS[name].basis, periodicity: CONVENTIONS[name].periodicity, timing: CONVENTIONS[name].timing });
  };
  const field = (key) => (event) => onChange({ [key]: event.target.value });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <TextField label="Valor de la tasa" type="number" step="any" inputMode="decimal" value={rate.value} onChange={field('value')} placeholder="Ej. 24" inputClassName="tabular-nums" />
        <SelectField label="Convención" value={showCustom ? 'custom' : named} onChange={(event) => pickConvention(event.target.value)}>
          {CONVENTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
      </div>
      {showCustom && (
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
          <SelectField label="Tipo de tasa" value={rate.basis} onChange={field('basis')}>
            <option value="effective">Efectiva</option>
            <option value="nominal">Nominal</option>
          </SelectField>
          <SelectField label="Periodo" value={rate.periodicity} onChange={field('periodicity')}>
            {PERIODS.map((period) => <option key={period} value={period}>{capitalize(PERIODICITY_ADJECTIVES[period])}</option>)}
          </SelectField>
          <SelectField label="Pago de intereses" value={rate.timing} onChange={field('timing')}>
            <option value="arrears">Vencido</option>
            <option value="advance">Anticipado</option>
          </SelectField>
        </div>
      )}
      <p aria-live="polite" className="text-sm text-ink-muted">
        {echo.ok ? <>Equivale a: <b className="font-semibold text-ink tabular-nums">{echo.label}</b></> : 'Escribe la tasa para ver su equivalente efectivo anual.'}
      </p>
    </div>
  );
}
