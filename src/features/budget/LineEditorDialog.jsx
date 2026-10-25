import { useState } from 'react';
import { roundUnit } from '@finance-core';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { TextField, labelClass } from '../../shared/ui/TextField';

const RULES = [{ value: 'fixed', label: 'Fijo' }, { value: 'percent', label: 'Porcentaje' }];
const SPANS = [{ value: 'onward', label: 'Desde este mes' }, { value: 'month', label: 'Solo este mes' }];
const MAX_BP = 10000;

const startText = (initial) => {
  if (initial?.rule === 'percent') return String((initial.percentBp || 0) / 100).replace('.', ',');
  return initial?.amountMinor > 0 ? String(initial.amountMinor) : '';
};

/** Parses the field: fixed is a whole amount, percent allows decimals and becomes basis points. */
function parseValue(rule, text) {
  const clean = text.trim().replace(',', '.');
  if (rule === 'fixed') return /^\d+$/.test(clean) && Number.isSafeInteger(Number(clean)) ? { value: Number(clean) } : { value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return { value: null };
  const value = Math.round(Number(clean) * 100);
  return value > MAX_BP ? { value: null, message: 'El porcentaje no puede pasar de 100 %.' } : { value };
}

/**
 * Editor of one budget line: fixed amount or percent of the month's income, for this month only or from this month on,
 * plus the two remove actions. It only collects the choice; the container plans and writes it.
 */
export default function LineEditorDialog({ name, kind, initial, base, monthOverride = false, error, busy = false, onSubmit, onRetry, onClose }) {
  const [rule, setRule] = useState(initial?.rule === 'percent' ? 'percent' : 'fixed');
  const [span, setSpan] = useState('onward');
  const [text, setText] = useState(startText(initial));
  const parsed = parseValue(rule, text);
  const income = kind === 'income';
  const preview = rule === 'percent' && parsed.value != null && base.source !== 'none'
    ? roundUnit((base.incomeMinor * parsed.value) / 10000) : null;

  const switchRule = (next) => { setRule(next); setText(next === initial?.rule || (!initial && !text) ? startText(initial) : ''); };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => { event.preventDefault(); if (parsed.value != null) onSubmit({ action: 'set', span, rule, value: parsed.value }); }}
        >
          <DialogHeader title={`Límite de ${name}`} />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {income ? (
              <p className="text-sm text-ink-2">Los ingresos no tienen límite: no se pueden presupuestar.</p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className={labelClass}>Tipo de límite</span>
                  <SegmentedControl label="Tipo de límite" options={RULES} value={rule} onChange={switchRule} fill />
                </div>
                <TextField
                  label={rule === 'fixed' ? 'Monto' : 'Porcentaje de tus ingresos'}
                  inputMode={rule === 'fixed' ? 'numeric' : 'decimal'}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder={rule === 'fixed' ? 'Ej. 500000' : 'Ej. 10'}
                  aria-invalid={parsed.message ? true : undefined}
                />
                {parsed.message && <p className="text-sm font-medium text-danger">{parsed.message}</p>}
                {rule === 'percent' && base.source === 'none' && (
                  <p className="text-[13px] text-ink-muted">Aún no hay ingresos este mes ni el anterior: el monto se calculará cuando los registres.</p>
                )}
                {preview != null && <p className="text-sm font-medium text-accent tabular-nums">{`Equivale a ${formatMoney(preview)}`}</p>}
                <div className="flex flex-col gap-1.5">
                  <span className={labelClass}>Aplica</span>
                  <SegmentedControl label="Aplica" options={SPANS} value={span} onChange={setSpan} fill />
                </div>
                {monthOverride && span === 'onward' && (
                  <p role="note" className="rounded-sm bg-danger-soft px-3 py-2 text-[13px] text-[#9a3412]">
                    Este mes tiene un ajuste puntual que seguirá aplicando. Para cambiarlo, elige «Solo este mes».
                  </p>
                )}
                <div className="flex flex-col gap-1 sm:flex-row">
                  <Button variant="secondary" onClick={() => onSubmit({ action: 'remove', span: 'month' })} disabled={busy}>Quitar solo este mes</Button>
                  <Button variant="secondary" onClick={() => onSubmit({ action: 'remove', span: 'onward' })} disabled={busy}>Quitar desde este mes</Button>
                </div>
              </>
            )}
            {error && (
              <div role="alert" className="flex flex-col gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-[#9a3412]">
                <span>{error}</span>
                {onRetry && <Button variant="secondary" onClick={onRetry}>Reintentar</Button>}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            {!income && <Button type="submit" disabled={busy || parsed.value == null}>{busy ? 'Guardando…' : 'Guardar'}</Button>}
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
