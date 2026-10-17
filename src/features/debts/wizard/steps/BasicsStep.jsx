import { useId } from 'react';
import { SegmentedControl } from '../../../../shared/ui/SegmentedControl';
import { TextField, labelClass } from '../../../../shared/ui/TextField';

const OWNER_OPTIONS = [{ value: 'shared', label: 'Compartida' }, { value: 'you', label: 'Tú' }, { value: 'partner', label: 'Pareja' }];

export default function BasicsStep({ state, set }) {
  const ownerLabelId = useId();
  const card = state.kind === 'card';
  const bind = (field) => ({ value: state[field], onChange: (event) => set({ [field]: event.target.value }) });

  return (
    <div className="flex flex-col gap-4">
      <TextField label="Nombre de la deuda" placeholder="Ej. Crédito del carro" {...bind('name')} />
      <TextField label="Prestamista (opcional)" placeholder="Ej. Bancolombia o tía Marta" {...bind('lender')} />
      {/* A card's date is the one of its last statement, asked in the card step once the statement day is known. */}
      <div className={card ? 'grid grid-cols-1' : 'grid grid-cols-1 gap-3 min-[400px]:grid-cols-2'}>
        <TextField label={card ? 'Saldo del último extracto (opcional)' : 'Monto del préstamo'} type="number" inputMode="numeric" placeholder="$ 0" inputClassName="tabular-nums" {...bind('principal')} />
        {!card && <TextField label="Fecha del desembolso" type="date" {...bind('openedOn')} />}
      </div>
      <div className="flex flex-col gap-1.5">
        <span id={ownerLabelId} className={labelClass}>¿De quién es?</span>
        <SegmentedControl labelledBy={ownerLabelId} options={OWNER_OPTIONS} value={state.ownerScope} onChange={(ownerScope) => set({ ownerScope })} fill />
      </div>
      {card && <p className="text-sm text-ink-muted">El saldo y los pagos se actualizan con cada extracto que registres; los gastos con la tarjeta no lo mueven solos.</p>}
      {state.kind === 'informal' && <p className="text-sm text-ink-muted">Sin plan de cuotas: llevamos el saldo y tus abonos.</p>}
    </div>
  );
}
