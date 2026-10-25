import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { categoryColor, iconForCategory } from '../../shared/lib/categories';
import { formatMoney, formatPercent, formatSignedMoney } from '../../shared/lib/format';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Card } from '../../shared/ui/Card';
import { Chip } from '../../shared/ui/Chip';
import { IconTile } from '../../shared/ui/IconTile';
import { PageHeader } from '../../shared/ui/PageHeader';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import { cn, focusRing } from '../../shared/ui/cn';
import AddCategoryDialog from './AddCategoryDialog';

const thClass = 'border-b border-border bg-surface-2 px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-ink-muted';
const tdClass = 'border-b border-[#eef1ed] px-4 py-3.5 align-middle text-sm whitespace-nowrap';

const GROUP_ORDER = ['need', 'want', 'saving', 'investment', 'debt'];
const GROUP_LABELS = { need: 'Necesidades', want: 'Gustos', saving: 'Ahorro', investment: 'Inversión', debt: 'Deudas' };
// Spending more than planned is good news for these groups (AD12): shown as achieved, never as over.
const GOAL_GROUPS = ['saving', 'investment'];

const LIMITATION_NOTE = 'Una compra con tarjeta de crédito cuenta en su categoría cuando la registras, y el pago posterior de la tarjeta cuenta de nuevo en Deudas. Esto se suma dos veces por diseño.';

const ruleLabel = (line) => (line?.rule === 'percent' ? `${formatPercent((line.percentBp || 0) / 100)}` : 'Fijo');

function Stat({ label, value, tone }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className={cn('text-[22px] font-semibold tracking-[-0.4px] tabular-nums', tone === 'danger' ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-ink')}>{value}</span>
    </div>
  );
}

/** Month totals over the limited targets (Presupuesto usado); spending without a limit never reads as overspending. */
function BudgetSummary({ budgetUsed, isCurrentMonth, dayOfMonth, daysInMonth }) {
  const { plannedMinor, spentMinor } = budgetUsed;
  const available = plannedMinor - spentMinor;
  const used = plannedMinor ? (spentMinor / plannedMinor) * 100 : 0;
  const dayLabel = isCurrentMonth ? `Día ${dayOfMonth} de ${daysInMonth}` : 'Mes cerrado';
  if (!plannedMinor) {
    return (
      <Card aria-label="Resumen del presupuesto" className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">Aún no hay límites este mes. Cuando los definas verás cuánto te queda.</p>
        <span className="text-xs text-ink-faint tabular-nums">{dayLabel}</span>
      </Card>
    );
  }
  return (
    <Card aria-label="Resumen del presupuesto" className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4">
        <Stat label="Planeado" value={formatMoney(plannedMinor)} />
        <Stat label="Gastado" value={formatMoney(spentMinor)} />
        <Stat label="Disponible" value={formatSignedMoney(available)} tone={available < 0 ? 'danger' : 'accent'} />
      </div>
      <div className="flex flex-col gap-1.5">
        <ProgressBar value={used} tone={used > 100 ? 'danger' : 'accent'} size="lg" />
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs text-ink-faint tabular-nums">
          <span>{`${formatPercent(used)} del presupuesto usado`}</span>
          <span>{dayLabel}</span>
        </div>
      </div>
    </Card>
  );
}

/** Where the S6a line editor plugs in: absent unless editing is on and a handler is wired. */
function EditButton({ label, target, onEditLine }) {
  if (!onEditLine) return null;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onEditLine(target)}
      className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-accent-soft hover:text-accent sm:h-9 sm:w-9', focusRing)}
    >
      <Pencil size={16} aria-hidden="true" />
    </button>
  );
}

/** Derived display of one category row: planned/actual/remaining and whether overshoot is bad or achieved. */
function rowState(row, groupKey) {
  const limited = row.plannedMinor > 0;
  const goal = GOAL_GROUPS.includes(groupKey);
  const over = limited && row.overBudget && !goal;
  const achieved = limited && row.overBudget && goal;
  return {
    limited, over, achieved,
    percent: limited ? (row.actualMinor / row.plannedMinor) * 100 : 0,
    remaining: !limited ? '—' : achieved ? `+ ${formatMoney(row.actualMinor - row.plannedMinor)}` : formatSignedMoney(row.remainingMinor),
    remainingClass: !limited ? 'text-ink-faint' : over ? 'font-semibold text-danger' : 'font-medium text-accent',
    color: categoryColor(row),
  };
}

function CategoryLabel({ row, category, state }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
      <IconTile icon={iconForCategory(category)} color={state.over ? undefined : state.color} tone={state.over ? 'danger' : 'accent'} size={32} />
      <span className="min-w-0 truncate font-medium text-ink">{row.name}</span>
      {state.over && <Chip tone="danger" className="font-semibold">Excedido</Chip>}
      {state.achieved && <Chip tone="you" className="font-semibold">Meta superada</Chip>}
    </span>
  );
}

function RuleChips({ row }) {
  if (!(row.plannedMinor > 0)) return <span className="text-ink-faint">Sin límite</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Chip tone="neutral">{ruleLabel(row.line)}</Chip>
      {row.householdFixed && <Chip tone="shared">Hogar</Chip>}
    </span>
  );
}

function Progress({ state }) {
  return (
    <span className="flex items-center gap-2.5">
      <ProgressBar value={state.percent} color={state.over ? undefined : state.color} tone={state.over ? 'danger' : 'accent'} className="flex-1" />
      <span className={cn('w-12 text-right text-[13px] tabular-nums', state.over ? 'font-semibold text-danger' : 'text-ink-2')}>
        {state.limited ? formatPercent(state.percent) : '—'}
      </span>
    </span>
  );
}

function editTarget(row) {
  return { targetType: 'category', targetId: row.categoryId };
}

function CategoryRow({ row, groupKey, category, onEditLine }) {
  const state = rowState(row, groupKey);
  return (
    <tr className={state.over ? 'bg-[#fff8f3]' : 'hover:bg-surface-2'}>
      <td className={tdClass}><CategoryLabel row={row} category={category} state={state} /></td>
      <td className={tdClass}><RuleChips row={row} /></td>
      <td className={tdClass}><Progress state={state} /></td>
      <td className={cn(tdClass, 'text-right tabular-nums')}>{formatMoney(row.actualMinor)}</td>
      <td className={cn(tdClass, 'text-right tabular-nums')}>{state.limited ? formatMoney(row.plannedMinor) : '—'}</td>
      <td className={cn(tdClass, 'text-right tabular-nums', state.remainingClass)}>{state.remaining}</td>
      <td className={cn(tdClass, 'w-14 py-1 text-right')}>
        <EditButton label={`Editar límite de ${row.name}`} target={editTarget(row)} onEditLine={onEditLine} />
      </td>
    </tr>
  );
}

/** Stacked card used below 640px so the page never scrolls sideways. */
function CategoryCard({ row, groupKey, category, onEditLine }) {
  const state = rowState(row, groupKey);
  return (
    <li className={cn('flex flex-col gap-3 border-b border-[#eef1ed] px-4 py-4 last:border-b-0', state.over && 'bg-[#fff8f3]')}>
      <div className="flex items-center justify-between gap-2">
        <CategoryLabel row={row} category={category} state={state} />
        <EditButton label={`Editar límite de ${row.name}`} target={editTarget(row)} onEditLine={onEditLine} />
      </div>
      <RuleChips row={row} />
      <Progress state={state} />
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="flex flex-col gap-0.5"><dt className="text-xs text-ink-muted">Real</dt><dd className="text-ink tabular-nums">{formatMoney(row.actualMinor)}</dd></div>
        <div className="flex flex-col gap-0.5 text-center"><dt className="text-xs text-ink-muted">Asignado</dt><dd className="text-ink tabular-nums">{state.limited ? formatMoney(row.plannedMinor) : '—'}</dd></div>
        <div className="flex flex-col gap-0.5 text-right"><dt className="text-xs text-ink-muted">Restante</dt><dd className={cn('tabular-nums', state.remainingClass)}>{state.remaining}</dd></div>
      </dl>
    </li>
  );
}

function GroupHeader({ groupKey, group, canEditLine, onEditLine, exceedsBy }) {
  const label = GROUP_LABELS[groupKey];
  const goal = GOAL_GROUPS.includes(groupKey);
  const allocated = group.allocatedMinor > 0;
  const over = allocated && group.overBudget && !goal;
  const achieved = allocated && group.overBudget && goal;
  const percent = allocated ? (group.actualMinor / group.allocatedMinor) * 100 : 0;
  return (
    <header className="flex flex-col gap-3 border-b border-border bg-surface-2 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-ink">{label}</h2>
          {over && <Chip tone="danger" className="font-semibold">Excedido</Chip>}
          {achieved && <Chip tone="you" className="font-semibold">Meta superada</Chip>}
        </div>
        {canEditLine && <EditButton label={`Editar tope de ${label}`} target={{ targetType: 'group', targetId: groupKey }} onEditLine={onEditLine} />}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm tabular-nums">
        <span className="text-ink-muted">Real <b className="font-semibold text-ink">{formatMoney(group.actualMinor)}</b></span>
        <span className="text-ink-muted">{group.envelope ? 'Tope del grupo' : 'Asignado'} <b className="font-semibold text-ink">{allocated ? formatMoney(group.allocatedMinor) : 'Sin límite'}</b></span>
        {allocated && <span className={cn('font-medium', over ? 'text-danger' : 'text-accent')}>{over ? formatSignedMoney(group.remainingMinor) : achieved ? `+ ${formatMoney(group.actualMinor - group.allocatedMinor)}` : formatMoney(group.remainingMinor)}</span>}
      </div>
      {allocated && <ProgressBar value={percent} tone={over ? 'danger' : 'accent'} />}
      {exceedsBy > 0 && (
        <p role="note" className="text-[13px] text-[#9a3412]">
          {`Los límites de las categorías suman ${formatMoney(exceedsBy)} más que el tope del grupo.`}
        </p>
      )}
    </header>
  );
}

function GroupSection({ groupKey, group, warnings, categoriesById, wide, onEditLine }) {
  const label = GROUP_LABELS[groupKey];
  const exceedsBy = warnings.find((warning) => warning.code === 'sublimits_exceed_envelope' && warning.group === groupKey)?.amountMinor || 0;
  const categoryOf = (row) => categoriesById.get(row.categoryId) || row;
  return (
    <Card as="section" padded={false} aria-label={`Grupo ${label}`} className="overflow-hidden">
      <GroupHeader groupKey={groupKey} group={group} canEditLine={Boolean(onEditLine)} onEditLine={onEditLine} exceedsBy={exceedsBy} />
      {!group.categories.length ? (
        <p className="px-4 py-4 text-sm text-ink-muted">No hay categorías en este grupo.</p>
      ) : wide ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th scope="col" className={thClass}>Categoría</th>
                <th scope="col" className={thClass}>Regla</th>
                <th scope="col" className={cn(thClass, 'w-[26%]')}>Progreso</th>
                <th scope="col" className={cn(thClass, 'text-right')}>Real</th>
                <th scope="col" className={cn(thClass, 'text-right')}>Asignado</th>
                <th scope="col" className={cn(thClass, 'text-right')}>Restante</th>
                <th scope="col" className={thClass}><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {group.categories.map((row) => <CategoryRow key={row.categoryId} row={row} groupKey={groupKey} category={categoryOf(row)} onEditLine={onEditLine} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label={`Categorías de ${label}`} className="flex flex-col">
          {group.categories.map((row) => <CategoryCard key={row.categoryId} row={row} groupKey={groupKey} category={categoryOf(row)} onEditLine={onEditLine} />)}
        </ul>
      )}
    </Card>
  );
}

/**
 * Presupuesto body: one section per budget group (envelope, rows with actual vs allocated). Read-only here;
 * `onEditLine({ targetType, targetId })` is the hook the line editor (S6a) plugs into, and the edit buttons
 * only exist while `canEdit` is on and a handler is given.
 */
export default function BudgetView({
  budgetMonth, allCategories = [], isCurrentMonth, dayOfMonth, daysInMonth,
  onCreateCategory, onEditLine, scopeControl, header, canEdit = true,
}) {
  const [addingCategory, setAddingCategory] = useState(false);
  const wide = useMediaQuery('(min-width: 640px)');
  const categoriesById = new Map(allCategories.map((category) => [category.$id, category]));
  const editLine = canEdit ? onEditLine : undefined;
  const warnings = budgetMonth.warnings || [];

  const createCategory = async (data) => {
    await onCreateCategory(data);
    setAddingCategory(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Presupuesto"
        subtitle="Cuánto asignaste a cada grupo y categoría, y cuánto llevas gastado."
        actions={scopeControl}
      />

      {header}

      {warnings.some((warning) => warning.code === 'debt_data_unavailable') && (
        <p role="note" className="rounded-sm bg-danger-soft px-4 py-3 text-sm text-[#9a3412]">
          No pudimos leer los pagos de deudas; el real del grupo Deudas puede estar incompleto.
        </p>
      )}

      <BudgetSummary budgetUsed={budgetMonth.totals.budgetUsed} isCurrentMonth={isCurrentMonth} dayOfMonth={dayOfMonth} daysInMonth={daysInMonth} />

      {GROUP_ORDER.map((key) => (
        <GroupSection key={key} groupKey={key} group={budgetMonth.groups[key]} warnings={warnings} categoriesById={categoriesById} wide={wide} onEditLine={editLine} />
      ))}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setAddingCategory(true)}
          className={cn('inline-flex h-11 items-center gap-2 self-start rounded-sm px-3 text-sm font-medium text-accent hover:bg-accent-soft sm:h-10', focusRing)}
        >
          <Plus size={16} aria-hidden="true" />Agregar categoría
        </button>
        <p className="text-xs text-ink-muted">{LIMITATION_NOTE}</p>
      </div>

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
