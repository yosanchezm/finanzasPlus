import { lazy, Suspense, useState } from 'react';
import { ChevronDown, PieChart as PieIcon } from 'lucide-react';
import { formatMoney, formatPercent, formatShort } from '../../shared/lib/format';
import { Card, CardHeader } from '../../shared/ui/Card';
import { EmptyState } from '../../shared/ui/EmptyState';
import { cn, focusRing } from '../../shared/ui/cn';
import { buildDonutSlices, OTHER_KEY } from './categoryDonut';
import { ChartSkeleton } from './charts/ChartSkeleton';

const CategoryDonutPlot = lazy(() => import('./charts/CategoryDonutPlot'));
const DONUT_SIZE = 144;

const rowClass = cn('flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-surface-2', focusRing);

function Swatch({ color }) {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />;
}

function Amounts({ value, share }) {
  return (
    <>
      <span className="ml-auto shrink-0 text-ink-muted tabular-nums">$ {formatShort(value)}</span>
      <span className="w-10 shrink-0 text-right text-ink-2 tabular-nums">{formatPercent(share * 100)}</span>
    </>
  );
}

/** One legend row: a button that opens the category's movements and previews it in the donut on hover/focus. */
function CategoryRow({ item, color, onPreview, onSelect, nested = false }) {
  return (
    <button
      type="button"
      aria-label={`Ver movimientos de ${item.name}: ${formatMoney(item.value)}, ${formatPercent(item.share * 100)}`}
      onClick={() => onSelect(item.categoryId)}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className={cn(rowClass, nested && 'pl-5')}
    >
      {color ? <Swatch color={color} /> : <span aria-hidden="true" className="size-2.5 shrink-0" />}
      <span className="min-w-0 truncate text-ink">{item.name}</span>
      <Amounts value={item.value} share={item.share} />
    </button>
  );
}

function DonutCenter({ total, active }) {
  return (
    <div data-testid="donut-center" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center">
      {active ? (
        <>
          <span className="max-w-full truncate text-xs text-ink-muted">{active.name}</span>
          <span className="text-base font-semibold text-ink tabular-nums">$ {formatShort(active.value)}</span>
          <span className="text-xs text-ink-faint tabular-nums">{formatPercent(active.share * 100)}</span>
        </>
      ) : (
        <>
          <span className="text-base font-semibold text-ink tabular-nums">$ {formatShort(total)}</span>
          <span className="text-xs text-ink-faint">gastado</span>
        </>
      )}
    </div>
  );
}

/**
 * Spending by category: the 5 biggest categories plus "Otros". Hovering or focusing a slice or a legend
 * row shows it in the center; clicking opens its movements. "Otros" expands to its folded categories.
 */
export function CategoryBreakdown({ stats, periodLabel, onSeeBudget, onSelectCategory = () => {} }) {
  const { total, slices } = buildDonutSlices(stats);
  const [activeKey, setActiveKey] = useState(null);
  const [showOther, setShowOther] = useState(false);
  const active = slices.find((slice) => slice.key === activeKey)
    || slices.find((slice) => slice.key === OTHER_KEY)?.members.find((member) => member.categoryId === activeKey)
    || null;
  const highlighted = slices.some((slice) => slice.key === activeKey) ? activeKey : activeKey && OTHER_KEY;

  const selectSlice = (slice) => (slice.key === OTHER_KEY ? setShowOther((open) => !open) : onSelectCategory(slice.categoryId));

  return (
    <Card as="article" className="flex flex-col gap-5">
      <CardHeader
        title="Gastos por categoría"
        subtitle={<span className="inline-block first-letter:uppercase">{periodLabel}</span>}
        action={(
          <button type="button" onClick={onSeeBudget} className={cn('rounded-sm text-[13px] font-medium text-accent hover:text-accent-hover', focusRing)}>
            Ver presupuesto
          </button>
        )}
      />
      {slices.length ? (
        <figure aria-label={`Gastos por categoría de ${periodLabel}`} className="m-0 flex flex-wrap items-center gap-5">
          <div className="relative mx-auto shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
            <div aria-hidden="true">
              <Suspense fallback={<ChartSkeleton round className="size-36" />}>
                <CategoryDonutPlot slices={slices} size={DONUT_SIZE} activeKey={highlighted} onHover={setActiveKey} onSelect={selectSlice} />
              </Suspense>
            </div>
            <DonutCenter total={total} active={active} />
          </div>
          <ul className="flex min-w-[200px] flex-1 flex-col gap-0.5 text-[13px]" onMouseLeave={() => setActiveKey(null)} onBlur={() => setActiveKey(null)}>
            {slices.map((slice) => (slice.key === OTHER_KEY ? (
              <li key={slice.key}>
                <button
                  type="button"
                  aria-expanded={showOther}
                  aria-label={`Otros (${slice.members.length}): ${formatMoney(slice.value)}, ${formatPercent(slice.share * 100)}`}
                  onClick={() => setShowOther((open) => !open)}
                  onMouseEnter={() => setActiveKey(slice.key)}
                  onFocus={() => setActiveKey(slice.key)}
                  className={rowClass}
                >
                  <Swatch color={slice.color} />
                  <span className="min-w-0 truncate text-ink">Otros ({slice.members.length})</span>
                  <ChevronDown aria-hidden="true" size={14} className={cn('shrink-0 text-ink-faint transition-transform', showOther && 'rotate-180')} />
                  <Amounts value={slice.value} share={slice.share} />
                </button>
                {showOther && (
                  <ul className="flex flex-col gap-0.5">
                    {slice.members.map((member) => (
                      <li key={member.categoryId}>
                        <CategoryRow item={member} onPreview={() => setActiveKey(member.categoryId)} onSelect={onSelectCategory} nested />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={slice.key}>
                <CategoryRow item={slice} color={slice.color} onPreview={() => setActiveKey(slice.key)} onSelect={onSelectCategory} />
              </li>
            )))}
          </ul>
        </figure>
      ) : (
        <EmptyState icon={PieIcon} message="Sin gastos registrados este mes." />
      )}
    </Card>
  );
}
