import { useId, useRef, useState } from 'react';
import { Check, Paperclip } from 'lucide-react';
import { DEFAULT_CURRENCY } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { DialogContent, DialogHeader, DialogRoot } from '../../shared/ui/Dialog';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { SelectField, TextField, labelClass } from '../../shared/ui/TextField';
import { cn } from '../../shared/ui/cn';

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES = 'image/jpeg,image/png,image/webp,application/pdf';

const TYPE_OPTIONS = [{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }];
const OWNER_OPTIONS = [{ value: 'you', label: 'Tú' }, { value: 'partner', label: 'Pareja' }, { value: 'shared', label: 'Compartido' }];

const categoriesForType = (categories, type) => categories.filter((category) => (type === 'income'
  ? category.kind === 'income' || category.name.toLowerCase().includes('ingreso')
  : category.kind !== 'income'));

const submitLabel = ({ saving, editing, type }) => {
  if (saving) return 'Guardando…';
  if (editing) return 'Guardar cambios';
  return type === 'income' ? 'Guardar ingreso' : 'Guardar gasto';
};

export default function TransactionModal({ form, setForm, categories, receiptFile, setReceiptFile, editing, saving, onClose, onSubmit }) {
  const [fileError, setFileError] = useState('');
  const amountRef = useRef(null);
  const ids = { amount: useId(), owner: useId(), fileError: useId() };
  const availableCategories = categoriesForType(categories, form.type);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const changeType = (type) => setForm({
    ...form,
    type,
    categoryId: categories.find((item) => (type === 'income' ? item.kind === 'income' : item.kind !== 'income'))?.$id || '',
  });

  const pickReceipt = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      setFileError('El recibo no puede superar 10 MB.');
      event.target.value = '';
      return;
    }
    setFileError('');
    setReceiptFile(file);
  };

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        variant="center"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => { event.preventDefault(); amountRef.current?.focus(); }}
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={editing ? 'Editar movimiento' : 'Nuevo movimiento'} />

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            <SegmentedControl label="Tipo de movimiento" options={TYPE_OPTIONS} value={form.type} onChange={changeType} fill size="lg" />

            <div className="flex flex-col items-center gap-1 pt-3 pb-1">
              <label htmlFor={ids.amount} className="text-[13px] font-medium text-ink-muted">Monto</label>
              <span className="flex items-baseline gap-1.5">
                <span aria-hidden="true" className="text-[28px] font-medium text-ink-faint">$</span>
                <input
                  ref={amountRef}
                  id={ids.amount}
                  required
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={form.amount}
                  onChange={update('amount')}
                  placeholder="0"
                  className="w-[220px] max-w-full rounded-sm bg-transparent text-center text-[40px] leading-tight font-semibold tracking-[-1px] text-ink tabular-nums outline-none placeholder:text-ink-faint/60 focus-visible:ring-3 focus-visible:ring-accent/15 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </span>
              <span className="text-xs text-ink-faint">{DEFAULT_CURRENCY}</span>
            </div>

            <TextField label="Concepto" required value={form.merchant} onChange={update('merchant')} placeholder="Ej. Mercado, nómina, taxi…" />

            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <SelectField label="Categoría" value={form.categoryId} onChange={update('categoryId')}>
                {availableCategories.map((category) => <option key={category.$id} value={category.$id}>{category.name}</option>)}
              </SelectField>
              <TextField label="Fecha" required type="date" value={form.date} onChange={update('date')} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span id={ids.owner} className={labelClass}>¿De quién?</span>
              <SegmentedControl labelledBy={ids.owner} options={OWNER_OPTIONS} value={form.owner} onChange={(owner) => setForm({ ...form, owner })} fill />
            </div>

            <TextField
              label={<>Nota <span className="font-normal text-ink-faint">(opcional)</span></>}
              value={form.note}
              onChange={update('note')}
              placeholder="Algo que quieras recordar"
            />

            {!editing && (
              <div className="flex flex-col gap-1.5">
                <label
                  className={cn(
                    'relative flex cursor-pointer items-center gap-3 rounded-[10px] border-[1.5px] border-dashed px-3.5 py-3 hover:border-accent hover:bg-[#f7fbf9]',
                    'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent',
                    fileError ? 'border-danger' : 'border-[#c3cbc5]',
                  )}
                >
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-sm bg-[#f0f2ef] text-ink-2">
                    <Paperclip size={18} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-ink">Adjuntar recibo</span>
                    <span className="truncate text-xs text-ink-faint">
                      {receiptFile ? `${receiptFile.name} · se subirá al bucket privado` : 'JPG, PNG, WEBP o PDF · máx. 10 MB'}
                    </span>
                  </span>
                  <input
                    type="file"
                    accept={RECEIPT_TYPES}
                    onChange={pickReceipt}
                    aria-describedby={fileError ? ids.fileError : undefined}
                    aria-invalid={fileError ? true : undefined}
                    className="sr-only"
                  />
                </label>
                {fileError && <p id={ids.fileError} role="alert" className="text-xs font-medium text-danger">{fileError}</p>}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-[#eef1ed] px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              <Check size={16} aria-hidden="true" />
              {submitLabel({ saving, editing, type: form.type })}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  );
}
