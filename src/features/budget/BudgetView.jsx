import { useState } from 'react';
import { Check, Copy, LoaderCircle, Plus } from 'lucide-react';
import { categoryColor, iconForCategory } from '../../shared/lib/categories';
import { addMonths } from '../../shared/lib/dates';
import { formatMoney, formatMonth, formatPercent, formatSignedMoney } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { Chip } from '../../shared/ui/Chip';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { IconTile } from '../../shared/ui/IconTile';
import { PageHeader } from '../../shared/ui/PageHeader';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import { cn, focusRing } from '../../shared/ui/cn';
import AddCategoryDialog from './AddCategoryDialog';

const thClass = 'border-b border-border bg-surface-2 px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-ink-muted';
const tdClass = 'border-b border-[#eef1ed] px-4 py-3.5 align-middle text-sm whitespace-nowrap';

const SAVE_LABELS = { saving: 'Guardando…', saved: 'Guardado', error: 'No se guardó' };

function Stat({ label, value, tone }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className={cn('text-[22px] font-semibold tracking-[-0.4px] tabular-nums', tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</span>
    </div>
  );
}

function BudgetSummary({ categories, isCurrentMonth, dayOfMonth, daysInMonth }) {
  const planned = categories.reduce((sum, item) => sum + Number(item.budget || 0), 0);
  const spent = categories.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const available = planned - spent;
  const limited = categories.filter((item) => Number(item.budget) > 0);
  const exceeded = limited.filter((item) => Number(item.value) > Number(item.budget)).length;
  const used = planned ? (spent / planned) * 100 : 0;

  return (
    <Card aria-label="Resumen del presupuesto" className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
        <Stat label="Planeado" value={formatMoney(planned)} />
        <Stat label="Gastado" value={formatMoney(spent)} />
        <Stat label="Disponible" value={formatSignedMoney(available)} tone={available < 0 ? 'danger' : 'accent'} />
        <Stat label="Categorías excedidas" value={`${exceeded} de ${limited.length}`} tone={exceeded ? 'danger' : undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <ProgressBar value={used} tone={used > 100 ? 'danger' : 'accent'} size="lg" />
        <div className="flex justify-between gap-3 text-xs text-ink-faint tabular-nums">
          <span>{planned ? `${formatPercent(used)} del presupuesto usado` : 'Sin presupuesto definido'}</span>
          <span>{isCurrentMonth ? `Día ${dayOfMonth} de ${daysInMonth}` : 'Mes cerrado'}</span>
        </div>
      </div>
    </Card>
  );
}

function SaveStatus({ status }) {
  return (
    <span role="status" className={cn('flex h-4 items-center justify-end gap-1 text-xs', status === 'error' ? 'text-danger' : 'text-ink-faint')}>
      {status === 'saving' && <LoaderCircle size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
      {status === 'saved' && <Check size={12} aria-hidden="true" className="text-accent" />}
      {SAVE_LABELS[status] || ''}
    </span>
  );
}

/**
 * One category row. The limit saves when the field loses focus (Enter blurs it), only when the
 * value changed, and the field stays read-only until that save and the refresh behind it finish,
 * so a second blur can never create a duplicate budget row.
 */
function BudgetRow({ category, existing, onSave }) {
  const savedValue = existing?.plannedMinor ?? '';
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState('idle');
  // When the stored limit changes (after this save's refresh, or a copy from the previous month),
  // drop the local draft so the row shows what is stored.
  const [seenSavedValue, setSeenSavedValue] = useState(savedValue);
  if (String(seenSavedValue) !== String(savedValue)) {
    setSeenSavedValue(savedValue);
    setDraft(null);
  }
  const value = draft ?? savedValue;
  const color = categoryColor(category);
  const spent = Number(category.value || 0);
  const limit = Number(value) || 0;
  const percent = limit ? (spent / limit) * 100 : 0;
  const over = limit > 0 && spent > limit;
  const remaining = limit ? limit - spent : null;

  const save = async () => {
    if (status === 'saving' || draft === null || String(draft) === String(savedValue)) return;
    if (draft !== '' && (Number.isNaN(Number(draft)) || Number(draft) < 0)) { setStatus('error'); return; }
    setStatus('saving');
    try {
      await onSave(category.$id, draft, existing);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <tr className={over ? 'bg-[#fff8f3]' : 'hover:bg-surface-2'}>
      <td className={tdClass}>
        <span className="flex items-center gap-2.5">
          <IconTile icon={iconForCategory(category)} color={over ? undefined : color} tone={over ? 'danger' : 'accent'} size={32} />
          <span className="font-medium text-ink">{category.name}</span>
          {over && <Chip tone="danger" className="font-semibold">Excedido</Chip>}
        </span>
      </td>
      <td className={tdClass}>
        <span className="flex items-center gap-2.5">
          <ProgressBar value={percent} color={over ? undefined : color} tone={over ? 'danger' : 'accent'} className="flex-1" />
          <span className={cn('w-12 text-right text-[13px] tabular-nums', over ? 'font-semibold text-danger' : 'text-ink-2')}>
            {limit ? formatPercent(percent) : '—'}
          </span>
        </span>
      </td>
      <td className={cn(tdClass, 'text-right tabular-nums')}>{formatMoney(spent)}</td>
      <td className={cn(tdClass, 'py-2 text-right')}>
        <span className="inline-flex flex-col items-end gap-0.5">
          <span className="relative inline-block">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-ink-faint">$</span>
            <label>
              <span className="sr-only">{`Límite de ${category.name}`}</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={value}
                readOnly={status === 'saving'}
                placeholder="Sin límite"
                onChange={(event) => { setDraft(event.target.value); if (status !== 'saving') setStatus('idle'); }}
                onBlur={save}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                className="h-10 w-[150px] rounded-sm border border-border-strong bg-surface pr-2.5 pl-6 text-right text-sm text-ink tabular-nums outline-none placeholder:text-ink-faint/80 read-only:bg-surface-2 read-only:text-ink-muted focus:border-accent focus:ring-3 focus:ring-accent/15"
              />
            </label>
          </span>
          <SaveStatus status={status} />
        </span>
      </td>
      <td className={cn(tdClass, 'text-right tabular-nums', remaining === null ? 'text-ink-faint' : remaining < 0 ? 'font-semibold text-danger' : 'font-medium text-accent')}>
        {remaining === null ? '—' : formatSignedMoney(remaining)}
      </td>
    </tr>
  );
}

const hasLimits = (budgets, month) => budgets.some((item) => item.month === month && Number(item.plannedMinor) > 0);

export default function BudgetView({
  categories, allCategories = categories, budgets, month, isCurrentMonth, dayOfMonth, daysInMonth,
  onSave, onCopyPrevious, onCreateCategory, scopeControl,
}) {
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const expenseCategories = categories.filter((category) => category.kind !== 'income');
  const previousMonth = addMonths(month, -1);
  const canCopy = hasLimits(budgets, previousMonth);

  const copy = async () => {
    setConfirmCopy(false);
    setCopying(true);
    try { await onCopyPrevious(); } finally { setCopying(false); }
  };

  const requestCopy = () => (hasLimits(budgets, month) ? setConfirmCopy(true) : copy());

  const createCategory = async (data) => {
    await onCreateCategory(data);
    setAddingCategory(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Presupuesto"
        subtitle="Define un límite por categoría. Se guarda al salir del campo o con Enter."
        actions={(
          <>
            {scopeControl}
            <Button
              variant="secondary"
              onClick={requestCopy}
              disabled={!canCopy || copying}
              title={canCopy ? `Copia los límites de ${formatMonth(previousMonth)}` : `${formatMonth(previousMonth)} no tiene límites para copiar`}
            >
              {copying ? <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Copy size={16} aria-hidden="true" />}
              Copiar del mes anterior
            </Button>
          </>
        )}
      />

      <BudgetSummary categories={expenseCategories} isCurrentMonth={isCurrentMonth} dayOfMonth={dayOfMonth} daysInMonth={daysInMonth} />

      <Card padded={false} className="overflow-hidden">
        {expenseCategories.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={thClass}>Categoría</th>
                  <th scope="col" className={cn(thClass, 'w-[34%]')}>Progreso</th>
                  <th scope="col" className={cn(thClass, 'text-right')}>Gastado</th>
                  <th scope="col" className={cn(thClass, 'text-right')}>Límite</th>
                  <th scope="col" className={cn(thClass, 'text-right')}>Restante</th>
                </tr>
              </thead>
              <tbody>
                {expenseCategories.map((category) => (
                  <BudgetRow
                    key={category.$id}
                    category={category}
                    existing={budgets.find((item) => item.categoryId === category.$id && item.month === month)}
                    onSave={onSave}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="Todavía no hay categorías de gasto. Agrega una para definir su límite." />
        )}
        <div className="border-t border-[#eef1ed] px-4 py-3">
          <button
            type="button"
            onClick={() => setAddingCategory(true)}
            className={cn('inline-flex h-10 items-center gap-2 rounded-sm px-3 text-sm font-medium text-accent hover:bg-accent-soft', focusRing)}
          >
            <Plus size={16} aria-hidden="true" />Agregar categoría
          </button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmCopy}
        onOpenChange={setConfirmCopy}
        title={`¿Reemplazar los límites de ${formatMonth(month)}?`}
        description={`Las categorías tomarán los límites de ${formatMonth(previousMonth)}. Los límites de categorías que no estaban en ese mes no cambian.`}
        confirmLabel="Copiar límites"
        confirmVariant="primary"
        onConfirm={copy}
      />

      {addingCategory && (
        <AddCategoryDialog
          existingNames={allCategories.map((category) => category.name)}
          onClose={() => setAddingCategory(false)}
          onSubmit={createCategory}
        />
      )}
    </div>
  );
}
