import { useMemo, useState } from 'react';
import { Download, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { formatDate, formatSignedMoney, formatTransactionAmount } from '../../shared/lib/format';
import { downloadTextFile } from '../../shared/lib/download';
import { relativeOwner } from '../../shared/lib/owners';
import { paginate } from '../../shared/lib/paginate';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { Button } from '../../shared/ui/Button';
import { Card } from '../../shared/ui/Card';
import { OwnerChip } from '../../shared/ui/Chip';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { EmptyState } from '../../shared/ui/EmptyState';
import { PageHeader } from '../../shared/ui/PageHeader';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { cn, focusRing } from '../../shared/ui/cn';
import { buildTransactionsCsv } from './csv';
import { TransactionRow } from './TransactionRow';

const TYPE_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'expense', label: 'Gastos' },
  { value: 'income', label: 'Ingresos' },
];

const thClass = 'border-b border-border bg-surface-2 px-4 py-2.5 text-left text-xs font-medium whitespace-nowrap text-ink-muted';
const tdClass = 'border-b border-[#eef1ed] px-4 py-3 text-sm whitespace-nowrap';

const matchesSearch = (item, query) => (
  `${item.merchant || ''} ${item.categoryName || ''} ${item.note || ''}`.toLowerCase().includes(query.trim().toLowerCase())
);

// The row itself opens the detail, so these buttons must not let the click reach it.
function RowActions({ item, onEdit, onDelete }) {
  const iconButton = cn('grid size-10 place-items-center rounded-sm text-ink-muted hover:bg-surface hover:text-ink', focusRing);
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button type="button" aria-label={`Editar ${item.merchant}`} title="Editar" onClick={(event) => { event.stopPropagation(); onEdit(item); }} className={iconButton}>
        <Pencil size={16} aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Eliminar ${item.merchant}`} title="Eliminar" onClick={(event) => { event.stopPropagation(); onDelete(item); }} className={cn(iconButton, 'hover:bg-danger-soft hover:text-danger')}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * Desktop table. The concept cell holds the real button (keyboard and screen readers);
 * clicking anywhere else on the row is a mouse shortcut to the same detail.
 */
function TransactionsTable({ items, currentOwnerScope, onEdit, onDelete, onOpenDetail }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            <th scope="col" className={thClass}>Fecha</th>
            <th scope="col" className={thClass}>Concepto</th>
            <th scope="col" className={thClass}>Categoría</th>
            <th scope="col" className={thClass}>Quién</th>
            <th scope="col" className={cn(thClass, 'text-right')}>Monto</th>
            <th scope="col" className={cn(thClass, 'w-[96px]')}><span className="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.$id} onClick={onOpenDetail ? () => onOpenDetail(item) : undefined} className={cn('hover:bg-surface-2', onOpenDetail && 'cursor-pointer')}>
              <td className={cn(tdClass, 'text-ink-muted tabular-nums')}>{formatDate(item.occurredAt)}</td>
              <td className={cn(tdClass, 'max-w-[280px] py-1.5 font-medium text-ink')}>
                {onOpenDetail ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`Ver detalle de ${item.merchant}`}
                    onClick={(event) => { event.stopPropagation(); onOpenDetail(item); }}
                    className={cn('block w-full truncate rounded-sm py-1.5 text-left font-medium hover:text-accent', focusRing)}
                  >
                    {item.merchant}
                  </button>
                ) : <span className="block truncate">{item.merchant}</span>}
              </td>
              <td className={tdClass}>
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <span aria-hidden="true" className="size-2 rounded-[2px]" style={{ backgroundColor: item.categoryColor || '#A7B0AB' }} />
                  {item.categoryName || 'Sin categoría'}
                </span>
              </td>
              <td className={tdClass}><OwnerChip ownerScope={item.ownerScope} currentOwnerScope={currentOwnerScope} /></td>
              <td className={cn(tdClass, 'text-right font-semibold tabular-nums', item.type === 'income' ? 'text-accent' : 'text-ink')}>
                {formatTransactionAmount(item)}
              </td>
              <td className={cn(tdClass, 'px-2 py-1')}><RowActions item={item} onEdit={onEdit} onDelete={onDelete} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PAGE_SIZE = 25;
const OWNER_OPTIONS = [
  { value: 'all', label: 'Todos los integrantes' },
  { value: 'you', label: 'Tú' },
  { value: 'partner', label: 'Pareja' },
  { value: 'shared', label: 'Compartido' },
];
const NO_CATEGORY = '__none__';

// Full width on phones so the filter bar stacks instead of overflowing; natural width from sm.
const selectClass = 'h-11 w-full min-w-0 rounded-sm border border-border-strong bg-surface px-3 text-base text-ink outline-none focus:border-accent focus:ring-3 focus:ring-accent/15 sm:h-10 sm:w-auto sm:text-sm';

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="w-full min-w-0 sm:w-auto">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cn(selectClass, value !== 'all' && 'border-accent bg-accent-soft text-[#074d37]')}>
        {children}
      </select>
    </label>
  );
}

function Pagination({ start, end, total, page, pageCount, onPage }) {
  const pagerButton = cn('h-9 rounded-sm border border-border-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-surface', focusRing);
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eef1ed] px-4 py-3 text-[13px] text-ink-muted">
      <span className="tabular-nums">{`Mostrando ${start}–${end} de ${total}`}</span>
      <div className="flex gap-2">
        <button type="button" className={pagerButton} disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
        <button type="button" className={pagerButton} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Siguiente</button>
      </div>
    </nav>
  );
}

/**
 * Month's transactions with search, type/category/owner filters, 25-row pages and CSV export.
 * `search` can be controlled by the parent (the topbar search sets it); otherwise it is local.
 */
export default function TransactionsView({
  transactions, categories = [], month, currentOwnerScope, onAdd, onEdit, onDelete, onOpenDetail, scopeControl,
  search: controlledSearch, onSearchChange,
}) {
  const [localSearch, setLocalSearch] = useState('');
  const search = controlledSearch ?? localSearch;
  const setSearch = onSearchChange ?? setLocalSearch;
  const [type, setType] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [owner, setOwner] = useState('all');
  const [pendingDelete, setPendingDelete] = useState(null);
  const wide = useMediaQuery('(min-width: 640px)');

  // A page number belongs to one combination of filters; changing any filter goes back to page 1.
  const filtersKey = [search, type, categoryId, owner].join('|');
  const [pageState, setPageState] = useState({ key: filtersKey, page: 1 });
  const requestedPage = pageState.key === filtersKey ? pageState.page : 1;

  const filtered = useMemo(() => transactions.filter((item) => (
    (type === 'all' || item.type === type)
    && (categoryId === 'all' || (categoryId === NO_CATEGORY ? !item.categoryId : item.categoryId === categoryId))
    && (owner === 'all' || relativeOwner(item.ownerScope, currentOwnerScope) === owner)
    && matchesSearch(item, search)
  )), [transactions, type, categoryId, owner, search, currentOwnerScope]);

  const { pageItems, page, pageCount, start, end, total } = paginate(filtered, requestedPage, PAGE_SIZE);
  const net = filtered.reduce((sum, item) => sum + (item.type === 'income' ? 1 : -1) * Number(item.amountMinor || 0), 0);
  const hasFilters = Boolean(search) || type !== 'all' || categoryId !== 'all' || owner !== 'all';
  const sortedCategories = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const clearFilters = () => {
    setSearch('');
    setType('all');
    setCategoryId('all');
    setOwner('all');
  };

  const exportCsv = () => {
    downloadTextFile(`movimientos-${month}.csv`, buildTransactionsCsv(filtered, currentOwnerScope), 'text/csv;charset=utf-8');
  };

  const confirmDelete = () => {
    const item = pendingDelete;
    setPendingDelete(null);
    onDelete(item);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Movimientos"
        subtitle="Consulta, filtra y corrige los registros del hogar."
        actions={(
          // Page-specific actions only; "Nuevo movimiento" lives in the topbar and the tab-bar FAB.
          <>
            {scopeControl}
            <Button variant="secondary" onClick={exportCsv} disabled={!filtered.length}>
              <Download size={16} aria-hidden="true" />Exportar CSV
            </Button>
          </>
        )}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative block w-full min-w-0 sm:w-auto sm:flex-[1_1_240px] sm:max-w-[320px]">
          <span className="sr-only">Buscar movimientos</span>
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Concepto, categoría o nota…"
            className="h-11 w-full rounded-sm border border-border-strong bg-surface pr-3 pl-9 text-base text-ink outline-none placeholder:text-ink-faint/80 focus:border-accent focus:ring-3 focus:ring-accent/15 sm:h-10 sm:text-sm"
          />
        </label>
        <SegmentedControl label="Tipo" options={TYPE_OPTIONS} value={type} onChange={setType} fill={!wide} className={wide ? undefined : 'w-full'} />
        <FilterSelect label="Categoría" value={categoryId} onChange={setCategoryId}>
          <option value="all">Todas las categorías</option>
          {sortedCategories.map((category) => <option key={category.$id} value={category.$id}>{category.name}</option>)}
          <option value={NO_CATEGORY}>Sin categoría</option>
        </FilterSelect>
        <FilterSelect label="Quién" value={owner} onChange={setOwner}>
          {OWNER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </FilterSelect>
        {hasFilters && (
          <button type="button" onClick={clearFilters} className={cn('inline-flex h-10 items-center gap-1.5 rounded-sm px-2 text-[13px] font-medium text-accent hover:bg-accent-soft', focusRing)}>
            <X size={14} aria-hidden="true" />Limpiar filtros
          </button>
        )}
        <span className="text-[13px] text-ink-muted tabular-nums sm:ml-auto">
          <span>{filtered.length === 1 ? '1 registro' : `${filtered.length} registros`}</span>
          <span> · neto <b className="font-semibold text-ink">{formatSignedMoney(net)}</b></span>
        </span>
      </div>

      <Card padded={false} className="overflow-hidden">
        {!filtered.length ? (
          <EmptyState
            message={transactions.length ? 'No hay movimientos que coincidan con tu búsqueda.' : 'Aún no hay movimientos en este periodo.'}
            actionLabel="Registrar movimiento"
            actionIcon={Plus}
            onAction={onAdd}
          />
        ) : (
          <>
            {wide ? (
              <TransactionsTable items={pageItems} currentOwnerScope={currentOwnerScope} onEdit={onEdit} onDelete={setPendingDelete} onOpenDetail={onOpenDetail} />
            ) : (
              <ul aria-label="Movimientos" className="flex flex-col p-1">
                {pageItems.map((item) => (
                  <TransactionRow
                    key={item.$id}
                    item={item}
                    currentOwnerScope={currentOwnerScope}
                    onOpen={onOpenDetail}
                    className="pr-1"
                    actions={<RowActions item={item} onEdit={onEdit} onDelete={setPendingDelete} />}
                  />
                ))}
              </ul>
            )}
            <Pagination start={start} end={end} total={total} page={page} pageCount={pageCount} onPage={(next) => setPageState({ key: filtersKey, page: next })} />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="¿Eliminar movimiento?"
        description={pendingDelete ? `“${pendingDelete.merchant}” se eliminará de Appwrite. Esta acción no se puede deshacer.` : ''}
        confirmLabel="Eliminar"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
