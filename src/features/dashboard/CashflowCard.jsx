import { lazy, Suspense, useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { formatMoney, formatMonthLabel } from '../../shared/lib/format';
import { Card, CardHeader } from '../../shared/ui/Card';
import { cn, focusRing } from '../../shared/ui/cn';
import { EmptyState } from '../../shared/ui/EmptyState';
import { SegmentedControl } from '../../shared/ui/SegmentedControl';
import { ChartSkeleton } from './charts/ChartSkeleton';
import { EXPENSE_COLOR, INCOME_COLOR } from './charts/chartTheme';

// Recharts is only downloaded when a chart is actually drawn.
const MonthlyBarsPlot = lazy(() => import('./charts/MonthlyBarsPlot'));
const DailyCashflowPlot = lazy(() => import('./charts/DailyCashflowPlot'));

const VIEW_OPTIONS = [{ value: 'monthly', label: '6 meses' }, { value: 'daily', label: 'Día a día' }];
const PLOT_HEIGHT = 'h-[220px]';
const MONTHLY_NAME = 'Ingresos y gastos de los últimos 6 meses';

const SERIES = [{ key: 'income', name: 'Ingresos', color: INCOME_COLOR }, { key: 'expenses', name: 'Gastos', color: EXPENSE_COLOR }];

/** Legend that doubles as a series toggle. The last visible series cannot be hidden. */
function Legend({ hidden, onToggle }) {
  const visibleCount = SERIES.filter((series) => !hidden[series.key]).length;
  return (
    <div role="group" aria-label="Series del flujo de caja" className="flex gap-1 text-[13px] text-ink-2">
      {SERIES.map((series) => {
        const shown = !hidden[series.key];
        return (
          <button
            key={series.key}
            type="button"
            aria-pressed={shown}
            disabled={shown && visibleCount === 1}
            onClick={() => onToggle(series.key)}
            title={shown ? `Ocultar ${series.name.toLowerCase()}` : `Mostrar ${series.name.toLowerCase()}`}
            className={cn('flex items-center gap-1.5 rounded-sm px-1.5 py-1 transition-colors hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent', focusRing, !shown && 'text-ink-faint line-through')}
          >
            <span aria-hidden="true" className={cn('size-2.5 rounded-[2px]', !shown && 'opacity-30')} style={{ backgroundColor: series.color }} />
            {series.name}
          </button>
        );
      })}
    </div>
  );
}

function Plot({ children }) {
  return (
    <div aria-hidden="true" className={`${PLOT_HEIGHT} w-full`}>
      <Suspense fallback={<ChartSkeleton className="size-full" />}>{children}</Suspense>
    </div>
  );
}

/** Days whose cumulative values changed, for the text alternative. */
const daysWithMovement = (series) => series.filter((point, index) => {
  const previous = series[index - 1];
  return previous ? point.income !== previous.income || point.expenses !== previous.expenses : point.income || point.expenses;
});

function MonthlyChart({ history, hidden, onSelectMonth }) {
  if (!history.some((entry) => entry.income || entry.expenses)) {
    return <EmptyState icon={BarChart3} message="Sin movimientos en los últimos 6 meses." />;
  }
  return (
    <figure aria-label={MONTHLY_NAME} className="m-0">
      <Plot><MonthlyBarsPlot history={history} hidden={hidden} onSelectMonth={onSelectMonth} /></Plot>
      {onSelectMonth && <figcaption className="mt-2 text-xs text-ink-faint">Toca un mes para ver su detalle.</figcaption>}
      <table className="sr-only">
        <caption>{MONTHLY_NAME}</caption>
        <thead><tr><th scope="col">Mes</th><th scope="col">Ingresos</th><th scope="col">Gastos</th></tr></thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.month}>
              <th scope="row">{formatMonthLabel(entry.month)}</th>
              <td>{formatMoney(entry.income)}</td>
              <td>{formatMoney(entry.expenses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function DailyChart({ series, periodLabel, hidden }) {
  if (!series.some((point) => point.income || point.expenses)) {
    return <EmptyState icon={TrendingUp} message="Sin movimientos este mes." />;
  }
  const name = `Flujo de caja acumulado de ${periodLabel}`;
  return (
    <figure aria-label={name} className="m-0">
      <Plot><DailyCashflowPlot series={series} hidden={hidden} /></Plot>
      <table className="sr-only">
        <caption>{name}</caption>
        <thead><tr><th scope="col">Día</th><th scope="col">Ingresos acumulados</th><th scope="col">Gastos acumulados</th></tr></thead>
        <tbody>
          {daysWithMovement(series).map((point) => (
            <tr key={point.day}>
              <th scope="row">{`Día ${point.day}`}</th>
              <td>{formatMoney(point.income)}</td>
              <td>{formatMoney(point.expenses)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * One card, two views of the same money flow with the same colors: the 6-month comparison
 * (default, as in the mockup) and the selected month's daily cumulative curve.
 */
export function CashflowCard({ history, series, periodLabel, onSelectMonth }) {
  const [view, setView] = useState('monthly');
  const [hidden, setHidden] = useState({ income: false, expenses: false });
  const toggle = (key) => setHidden((current) => ({ ...current, [key]: !current[key] }));
  return (
    <Card as="article" className="flex flex-col gap-5">
      <CardHeader
        title="Flujo de caja"
        subtitle={view === 'monthly' ? 'Últimos 6 meses' : `Acumulado diario de ${periodLabel}`}
        action={(
          <div className="flex flex-wrap items-center gap-3">
            <Legend hidden={hidden} onToggle={toggle} />
            <SegmentedControl label="Vista del flujo de caja" options={VIEW_OPTIONS} value={view} onChange={setView} />
          </div>
        )}
      />
      {view === 'monthly'
        ? <MonthlyChart history={history} hidden={hidden} onSelectMonth={onSelectMonth} />
        : <DailyChart series={series} periodLabel={periodLabel} hidden={hidden} />}
    </Card>
  );
}
