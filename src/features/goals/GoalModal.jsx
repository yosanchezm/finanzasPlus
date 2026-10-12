import { useId, useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { TextField, labelClass } from '../../shared/ui/TextField';

const OWNER_OPTIONS = [{ value: 'shared', label: 'Compartida' }, { value: 'you', label: 'Tú' }, { value: 'partner', label: 'Pareja' }];

export default function GoalModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({ name: '', targetMinor: '', targetDate: '', ownerScope: 'shared' });
  const ownerLabelId = useId();
  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = (event) => {
    event.preventDefault();
    if (!form.name.trim() || !Number(form.targetMinor)) return;
    onSubmit(form);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Nueva meta" />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <TextField label="Nombre" required value={form.name} onChange={update('name')} placeholder="Ej. Fondo de emergencia" />
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <TextField label="Objetivo" required type="number" min="1" inputMode="numeric" value={form.targetMinor} onChange={update('targetMinor')} placeholder="$ 0" inputClassName="tabular-nums" />
              <TextField label="Fecha objetivo" type="date" value={form.targetDate} onChange={update('targetDate')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span id={ownerLabelId} className={labelClass}>¿Para quién?</span>
              <SegmentedControl labelledBy={ownerLabelId} options={OWNER_OPTIONS} value={form.ownerScope} onChange={(ownerScope) => setForm({ ...form, ownerScope })} fill />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit"><Target size={16} aria-hidden="true" />Crear meta</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
