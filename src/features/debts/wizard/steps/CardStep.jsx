import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../shared/ui/Button';
import { SelectField, TextField } from '../../../../shared/ui/TextField';
import { MIN_RULES, NEW_PURCHASE } from '../wizardModel';

const money = { type: 'number', inputMode: 'numeric', placeholder: '$ 0', inputClassName: 'tabular-nums' };

function Purchases({ items, onChange }) {
  const update = (index, patch) => onChange(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const field = (index, key) => ({ value: items[index][key], onChange: (event) => update(index, { [key]: event.target.value }) });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-ink">Compras a cuotas que ya tienes</h3>
        <p className="text-[13px] text-ink-muted">Cada una conserva su tasa y sus cuotas. Pon 0 si el banco no cobra intereses.</p>
      </div>
      {items.map((item, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-3">
          <TextField label={`Descripción de la compra ${index + 1}`} placeholder="Ej. Nevera" {...field(index, 'label')} />
          <div className="grid grid-cols-3 gap-2">
            <TextField className="col-span-3 min-[400px]:col-span-1" label={`Valor de la compra ${index + 1}`} {...money} {...field(index, 'amount')} />
            <TextField label={`Cuotas de la compra ${index + 1}`} type="number" inputMode="numeric" inputClassName="tabular-nums" {...field(index, 'n')} />
            <TextField label={`Tasa E.A. de la compra ${index + 1}`} type="number" step="any" inputMode="decimal" inputClassName="tabular-nums" {...field(index, 'rate')} />
          </div>
          <Button variant="ghost" onClick={() => onChange(items.filter((_, at) => at !== index))} className="self-end">
            <Trash2 size={16} aria-hidden="true" />Quitar compra {index + 1}
          </Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...items, NEW_PURCHASE])} className="self-start">
        <Plus size={16} aria-hidden="true" />Agregar compra a cuotas
      </Button>
    </div>
  );
}

/** Statement and due day, minimum-payment rule, management fee with its IVA link, and the purchases the card already has. */
export default function CardStep({ card, dispatch }) {
  const set = (patch) => dispatch({ type: 'card', patch });
  const bind = (key) => ({ value: card[key], onChange: (event) => set({ [key]: event.target.value }) });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <TextField label="Día de corte" type="number" inputMode="numeric" placeholder="Ej. 15" inputClassName="tabular-nums" {...bind('statementDay')} />
        <TextField label="Día límite de pago" type="number" inputMode="numeric" placeholder="Ej. 30" inputClassName="tabular-nums" {...bind('dueDay')} />
      </div>
      <p className="-mt-3 text-[13px] text-ink-muted">Si el mes es más corto, usamos su último día.</p>

      <div className="flex flex-col gap-3">
        <SelectField label="Cómo se calcula tu pago mínimo" {...bind('minRule')}>
          {MIN_RULES.map((rule) => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
        </SelectField>
        {card.minRule !== 'installments_due' && (
          <TextField label="Porcentaje del pago mínimo (%)" type="number" step="any" inputMode="decimal" inputClassName="tabular-nums" {...bind('minPct')} />
        )}
        <TextField label="Pago mínimo de al menos (opcional)" {...money} {...bind('minFloor')} />
      </div>

      <div className="flex flex-col gap-3">
        <TextField label="Cuota de manejo mensual (opcional)" {...money} {...bind('fee')} />
        {card.fee !== '' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-1">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
              <input type="checkbox" className="size-5 accent-accent" checked={card.feeIva} onChange={(event) => set({ feeIva: event.target.checked })} />
              Sumar IVA a la cuota de manejo
            </label>
            {card.feeIva && (
              <TextField className="w-28" label="IVA (%)" type="number" step="any" inputMode="decimal" inputClassName="tabular-nums" {...bind('feeIvaPct')} />
            )}
          </div>
        )}
      </div>

      <p className="text-[13px] text-ink-muted">Si no pagas el mínimo a tiempo, cobramos mora al tope de usura. Puedes cambiarla después en «Más acciones».</p>

      <Purchases items={card.deferred} onChange={(deferred) => set({ deferred })} />
    </div>
  );
}
