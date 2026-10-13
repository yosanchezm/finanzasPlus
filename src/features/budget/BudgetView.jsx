import { useState } from 'react';
import { Check, Copy, LoaderCircle, Plus } from 'lucide-react';
import { categoryColor, iconForCategory } from '../../shared/lib/categories';
import { addMonths } from '../../shared/lib/dates';
import { formatMoney, formatMonth, formatPercent, formatSignedMoney } from '../../shared/lib/format';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
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

const hasLimits = (budgets, month) => budgets.some((item) => item.month === month && Number(item.plannedMinor) > 0);

function Stat({ label, value, tone }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className={cn('text-[22px] font-semibold tracking-[-0.4px] tabular-nums', tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-ink-muted' : 'text-ink')}>{value}</span>
    </div>
  );
}

/**
 * Month totals. Disponible only counts categories that have a limit; spending in categories
 * without one is shown apart so it never reads as overspending. Without any limit there is
 * nothing to compare against, so the summary asks for limits instead of showing a negative.
 */
function BudgetSummary({ categories, monthHasLimits, isCurrentMonth, dayOfMonth, daysInMonth, copyAction }) {
  const limited = categories.filter((item) => Number(item.budget) > 0);
  const unlimited = categories.filter((item) => !(Number(item.budget) > 0));
  const planned = limited.reduce((sum, item) => sum + Number(item.budget), 0);
  const spentLimited = limited.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const spentUnlimited = unlimited.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const available = planned - spentLimited;
  const exceeded = limited.filter((item) => Number(item.value) > Number(item.budget)).length;
  const used = planned ? (spentLimited / planned) * 100 : 0;
  const withLimits = monthHasLimits && limited.length > 0;
  const dayLabel = isCurrentMonth ? `Día ${dayOfMonth} de ${daysInMonth}` : 'Mes cerrado';

  if (!withLimits) {
    return (
      <Card aria-label="Resumen del presupuesto" className="flex flex-col gap-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
          <Stat label="Planeado" value="Sin definir" tone="muted" />
          <Stat label="Gastado" value={formatMoney(spentLimited + spentUnlimited)} />
          <Stat label="Disponible" value="—" tone="muted" />
        </div>
        <div className="flex flex-col gap-3 rounded-sm bg-surface-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-2">Define un límite por categoría para ver cuánto te queda.</p>
          {copyAction}
        </div>
        <span className="text-xs text-ink-faint tabular-nums">{dayLabel}</span>
      </Card>
    );
  }

  return (
    <Card aria-label="Resumen del presupuesto" className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
        <Stat label="Planeado" value={formatMoney(planned)} />
        <Stat label="Gastado" value={formatMoney(spentLimited)} />
        <Stat label="Disponible" value={formatSignedMoney(available)} tone={available < 0 ? 'danger' : 'accent'} />
        <Stat label="Categorías excedidas" value={`${exceeded} de ${limited.length}`} tone={exceeded ? 'danger' : undefined} />
      </div>
      <div className="flex flex-col gap-1.5">
        <ProgressBar value={used} tone={used > 100 ? 'danger' : 'accent'} size="lg" />
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-ink-faint tabular-nums">
          <span>{`${formatPercent(used)} del presupuesto usado`}</span>
          <span>{dayLabel}</span>
        </div>
      </div>
      {spentUnlimited > 0 && (
        <p className="text-[13px] text-ink-muted tabular-nums">
          Gasto sin límite: <b className="font-semibold text-ink">{formatMoney(spentUnlimited)}</b>
        </p>
      )}
    </Card>
  );
}

/**
 * Limit editing shared by the table row and the mobile card. Saves on blur (Enter blurs) only when
 * the value changed; the field is read-only until the save and its refresh finish, so a second blur
 * can never create a duplicate budget row.
 */
function useBudgetLimit(category, existing, onSave) {
  const savedValue = existing?.plannedMinor ?? '';
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState('idle');
  // When the stored limit changes (after this save's refresh, or a copy), show what is stored.
  const [seenSavedValue, setSeenSavedValue] = useState(savedValue);
  if (String(seenSavedValue) !== String(savedValue)) {
    setSeenSavedValue(savedValue);
    setDraft(null);
  }
  const value = draft ?? savedValue;
  const spent = Number(category.value || 0);
  const limit = Number(value) || 0;

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

  return {
    status,
    spent,
    limit,
    percent: limit ? (spent / limit) * 100 : 0,
    over: limit > 0 && spent > limit,
    remaining: limit ? limit - spent : null,
    color: categoryColor(category),
    inputProps: {
      type: 'number',
      min: '0',
      inputMode: 'numeric',
      value,
      readOnly: status === 'saving',
      placeholder: 'Sin límite',
      onChange: (event) => { setDraft(event.target.value); if (status !== 'saving') setStatus('idle'); },
      onBlur: save,
      onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } },
    },
  };
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

function LimitInput({ categoryName, inputProps, className }) {
  return (
    <span className={cn('relative inline-block', className)}>
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-faint">$</span>
      <label>
        <span className="sr-only">{`Límite de ${categoryName}`}</span>
        <input
          {...inputProps}
          className="h-11 w-full rounded-sm border border-border-strong bg-surface pr-3 pl-7 text-right text-base text-ink tabular-nums outline-none placeholder:text-ink-faint/80 read-only:bg-surface-2 read-only:text-ink-muted focus:border-accent focus:ring-3 focus:ring-accent/15 sm:h-10 sm:text-sm"
        />
      </label>
    </span>
  );
}

function CategoryLabel({ category, over, color }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <IconTile icon={iconForCategory(category)} color={over ? undefined : color} tone={over ? 'danger' : 'accent'} size={32} />
      <span className="min-w-0 truncate font-medium text-ink">{category.name}</span>
      {over && <Chip tone="danger" className="font-semibold">Excedido</Chip>}
    </span>
  );
}

function Progress({ limit, percent, over, color }) {
  return (
    <span className="flex items-center gap-2.5">
      <ProgressBar value={percent} color={over ? undefined : color} tone={over ? 'danger' : 'accent'} className="flex-1" />
      <span className={cn('w-12 text-right text-[13px] tabular-nums', over ? 'font-semibold text-danger' : 'text-ink-2')}>
        {limit ? formatPercent(percent) : '—'}
      </span>
    </span>
  );
}

const remainingClass = (remaining) => (remaining === null ? 'text-ink-faint' : remaining < 0 ? 'font-semibold text-danger' : 'font-medium text-accent');

function BudgetTableRow({ category, existing, onSave }) {
  const row = useBudgetLimit(category, existing, onSave);
  return (
    <tr className={row.over ? 'bg-[#fff8f3]' : 'hover:bg-surface-2'}>
      <td className={tdClass}><CategoryLabel category={category} over={row.over} color={row.color} /></td>
      <td className={tdClass}><Progress {...row} /></td>
      <td className={cn(tdClass, 'text-right tabular-nums')}>{formatMoney(row.spent)}</td>
      <td className={cn(tdClass, 'py-2 text-right')}>
        <span className="inline-flex flex-col items-end gap-0.5">
          <LimitInput categoryName={category.name} inputProps={row.inputProps} className="w-[150px]" />
          <SaveStatus status={row.status} />
        </span>
      </td>
      <td className={cn(tdClass, 'text-right tabular-nums', remainingClass(row.remaining))}>
        {row.remaining === null ? '—' : formatSignedMoney(row.remaining)}
      </td>
    </tr>
  );
}

/** Stacked card used below 640px so the page never scrolls sideways. */
function BudgetCard({ category, existing, onSave }) {
  const row = useBudgetLimit(category, existing, onSave);
  return (
    <li className={cn('flex flex-col gap-3 border-b border-[#eef1ed] px-4 py-4 last:border-b-0', row.over && 'bg-[#fff8f3]')}>
      <CategoryLabel category={category} over={row.over} color={row.color} />
      <Progress {...row} />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-muted">Gastado</dt>
          <dd className="text-ink tabular-nums">{formatMoney(row.spent)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <dt className="text-xs text-ink-muted">Restante</dt>
          <dd className={cn('tabular-nums', remainingClass(row.remaining))}>{row.remaining === null ? '—' : formatSignedMoney(row.remaining)}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1">
        <LimitInput categoryName={category.name} inputProps={row.inputProps} className="w-full" />
        <SaveStatus status={row.status} />
      </div>
    </li>
  );
}

export default function BudgetView({
  categories, allCategories = categories, budgets, month, isCurrentMonth, dayOfMonth, daysInMonth,
  onSave, onCopyPrevious, onCreateCategory, scopeControl,
}) {
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const wide = useMediaQuery('(min-width: 640px)');
  const expenseCategories = categories.filter((category) => category.kind !== 'income');
  const previousMonth = addMonths(month, -1);
  const canCopy = hasLimits(budgets, previousMonth);
  const monthHasLimits = hasLimits(budgets, month);
  const existingFor = (category) => budgets.find((item) => item.categoryId === category.$id && item.month === month);

  const copy = async () => {
    setConfirmCopy(false);
    setCopying(true);
    try { await onCopyPrevious(); } finally { setCopying(false); }
  };

  const requestCopy = () => (monthHasLimits ? setConfirmCopy(true) : copy());

  const createCategory = async (data) => {
    await onCreateCategory(data);
    setAddingCategory(false);
  };

  const copyButton = (
    <Button
      variant="secondary"
      onClick={requestCopy}
      disabled={!canCopy || copying}
      title={canCopy ? `Copia los límites de ${formatMonth(previousMonth)}` : `${formatMonth(previousMonth)} no tiene límites para copiar`}
      className="shrink-0"
    >
      {copying ? <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Copy size={16} aria-hidden="true" />}
      Copiar del mes anterior
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Presupuesto"
        subtitle="Define un límite por categoría. Se guarda al salir del campo o con Enter."
        actions={(
          <>
            {scopeControl}
            {/* Without limits this month, the copy action lives in the summary prompt instead. */}
            {monthHasLimits && copyButton}
          </>
        )}
      />

      <BudgetSummary
        categories={expenseCategories}
        monthHasLimits={monthHasLimits}
        isCurrentMonth={isCurrentMonth}
        dayOfMonth={dayOfMonth}
        daysInMonth={daysInMonth}
        copyAction={canCopy ? copyButton : null}
      />

      <Card padded={false} className="overflow-hidden">
        {!expenseCategories.length ? (
          <EmptyState message="Todavía no hay categorías de gasto. Agrega una para definir su límite." />
        ) : wide ? (
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
                  <BudgetTableRow key={category.$id} category={category} existing={existingFor(category)} onSave={onSave} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul aria-label="Categorías" className="flex flex-col">
            {expenseCategories.map((category) => (
              <BudgetCard key={category.$id} category={category} existing={existingFor(category)} onSave={onSave} />
            ))}
          </ul>
        )}
        <div className="border-t border-[#eef1ed] px-4 py-3">
          <button
            type="button"
            onClick={() => setAddingCategory(true)}
            className={cn('inline-flex h-11 items-center gap-2 rounded-sm px-3 text-sm font-medium text-accent hover:bg-accent-soft sm:h-10', focusRing)}
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
