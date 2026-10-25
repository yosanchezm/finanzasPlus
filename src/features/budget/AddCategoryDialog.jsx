import { useId, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { foldCategoryName } from '@finance-core';
import { CATEGORY_ICON_OPTIONS, CATEGORY_PALETTE, PALETTE_NAMES } from '../../shared/lib/categories';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { SelectField, TextField, labelClass } from '../../shared/ui/TextField';
import { GROUP_LABELS } from './groupLabels';

// The kind is the budget group. `debt` is system-owned (credit-card and debt categories), so it is not offered.
const KIND_OPTIONS = [
  ...['need', 'want', 'saving', 'investment'].map((value) => ({ value, label: GROUP_LABELS[value] })),
  { value: 'income', label: 'Ingreso' },
];

/** New category: name, kind, a palette color (no free hex) and an optional icon key. */
export default function AddCategoryDialog({ existingNames = [], onClose, onSubmit }) {
  const [form, setForm] = useState({ name: '', kind: 'need', color: CATEGORY_PALETTE[0], icon: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ids = { color: useId(), error: useId() };

  const submit = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) { setError('Escribe un nombre.'); return; }
    if (existingNames.some((existing) => foldCategoryName(existing) === foldCategoryName(name))) {
      setError('Ya existe una categoría con ese nombre.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await onSubmit({ ...form, name });
    } catch {
      setError('No se pudo crear la categoría.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="center" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title="Nueva categoría" />
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <TextField
              label="Nombre"
              required
              maxLength={80}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ej. Mascotas"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ids.error : undefined}
            />

            <SelectField label="Tipo" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </SelectField>

            <div className="flex flex-col gap-1.5">
              <span id={ids.color} className={labelClass}>Color</span>
              <div role="radiogroup" aria-labelledby={ids.color} className="flex flex-wrap gap-2">
                {CATEGORY_PALETTE.map((color) => (
                  <label key={color} className="relative cursor-pointer">
                    <input
                      type="radio"
                      name="category-color"
                      value={color}
                      checked={form.color === color}
                      onChange={() => setForm({ ...form, color })}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="grid size-10 place-items-center rounded-full text-white ring-offset-2 peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                      style={{ backgroundColor: color }}
                    >
                      {form.color === color && <Check size={18} strokeWidth={2.5} />}
                    </span>
                    <span className="sr-only">{PALETTE_NAMES[color]}</span>
                  </label>
                ))}
              </div>
            </div>

            <SelectField label="Icono (opcional)" value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })}>
              <option value="">Sin icono</option>
              {CATEGORY_ICON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </SelectField>

            {error && <p id={ids.error} role="alert" className="text-sm font-medium text-danger">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}><Plus size={16} aria-hidden="true" />{busy ? 'Creando…' : 'Crear categoría'}</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
