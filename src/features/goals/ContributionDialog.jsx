import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { formatMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { TextField } from '../../shared/ui/TextField';
import { goalProgress } from './goalMath';

/** Adds an amount to a goal. Overshooting the target is allowed; the UI caps the progress at 100 %. */
export default function ContributionDialog({ goal, onClose, onSubmit }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const { current, target } = goalProgress(goal);

  const submit = async (event) => {
    event.preventDefault();
    const value = Math.round(Number(amount));
    if (!amount || Number.isNaN(value) || value <= 0) {
      setError('Escribe un monto mayor que cero.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit(value);
    } catch {
      setError('No se pudo guardar el aporte.');
      setBusy(false);
    }
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" className="sm:w-[420px]">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={`Registrar aporte a ${goal.name}`} description={`Llevan ${formatMoney(current)} de ${formatMoney(target)}.`} />
          <div className="flex flex-col gap-3 px-6 py-5">
            <TextField
              label="Monto del aporte"
              type="number"
              min="1"
              inputMode="numeric"
              autoFocus
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="$ 0"
              inputClassName="tabular-nums"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error && <p id={errorId} role="alert" className="text-sm font-medium text-danger">{error}</p>}
          </div>
          <div className="mt-auto flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}><Check size={16} aria-hidden="true" />{busy ? 'Guardando…' : 'Guardar aporte'}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
