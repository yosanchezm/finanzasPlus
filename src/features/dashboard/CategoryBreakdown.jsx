import { lazy, Suspense } from 'react';
import { PieChart as PieIcon } from 'lucide-react';
import { categoryColor } from '../../shared/lib/categories';
import { formatMoney, formatPercent, formatShort } from '../../shared/lib/format';
import { Card, CardHeader } from '../../shared/ui/Card';
import { EmptyState } from '../../shared/ui/EmptyState';
import { cn, focusRing } from '../../shared/ui/cn';
import { ChartSkeleton } from './charts/ChartSkeleton';

const CategoryDonutPlot = lazy(() => import('./charts/CategoryDonutPlot'));
const DONUT_SIZE = 128;

export function CategoryBreakdown({ stats, periodLabel, onSeeBudget }) {
  const items = stats
    .filter((item) => Number(item.value) > 0)
    .map((item) => ({ ...item, color: categoryColor(item) }))
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + Number(item.value), 0);

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
      {items.length ? (
        <figure aria-label={`Gastos por categoría de ${periodLabel}`} className="m-0 flex flex-wrap items-center gap-5">
          <div className="relative shrink-0" style={{ width: DONUT_SIZE, height: DONUT_SIZE }}>
            <div aria-hidden="true">
              <Suspense fallback={<ChartSkeleton round className="size-32" />}>
                <CategoryDonutPlot items={items} size={DONUT_SIZE} />
              </Suspense>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-semibold text-ink tabular-nums">$ {formatShort(total)}</span>
              <span className="text-xs text-ink-faint">gastado</span>
            </div>
          </div>
          <ul className="flex min-w-[160px] flex-1 flex-col gap-2 text-[13px]">
            {items.map((item) => (
              <li key={item.$id} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                <span className="min-w-0 truncate text-ink">{item.name}</span>
                <span className="sr-only">{formatMoney(item.value)}</span>
                <span className="ml-auto text-ink-2 tabular-nums">{formatPercent((item.value / total) * 100)}</span>
              </li>
            ))}
          </ul>
        </figure>
      ) : (
        <EmptyState icon={PieIcon} message="Sin gastos registrados este mes." />
      )}
    </Card>
  );
}
