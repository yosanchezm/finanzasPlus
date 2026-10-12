import { lazy, Suspense, useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { formatMoney, formatMonthLabel } from '../../shared/lib/format';
import { Card, CardHeader } from '../../shared/ui/Card';
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

function Legend() {
  return (
    <div aria-hidden="true" className="flex gap-4 text-[13px] text-ink-2">
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ backgroundColor: INCOME_COLOR }} />Ingresos</span>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ backgroundColor: EXPENSE_COLOR }} />Gastos</span>
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

function MonthlyChart({ history }) {
  if (!history.some((entry) => entry.income || entry.expenses)) {
    return <EmptyState icon={BarChart3} message="Sin movimientos en los últimos 6 meses." />;
  }
  return (
    <figure aria-label={MONTHLY_NAME} className="m-0">
      <Plot><MonthlyBarsPlot history={history} /></Plot>
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

function DailyChart({ series, periodLabel }) {
  if (!series.some((point) => point.income || point.expenses)) {
    return <EmptyState icon={TrendingUp} message="Sin movimientos este mes." />;
  }
  const name = `Flujo de caja acumulado de ${periodLabel}`;
  return (
    <figure aria-label={name} className="m-0">
      <Plot><DailyCashflowPlot series={series} /></Plot>
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
export function CashflowCard({ history, series, periodLabel }) {
  const [view, setView] = useState('monthly');
  return (
    <Card as="article" className="flex flex-col gap-5">
      <CardHeader
        title="Flujo de caja"
        subtitle={view === 'monthly' ? 'Últimos 6 meses' : `Acumulado diario de ${periodLabel}`}
        action={(
          <div className="flex flex-wrap items-center gap-3">
            <Legend />
            <SegmentedControl label="Vista del flujo de caja" options={VIEW_OPTIONS} value={view} onChange={setView} />
          </div>
        )}
      />
      {view === 'monthly' ? <MonthlyChart history={history} /> : <DailyChart series={series} periodLabel={periodLabel} />}
    </Card>
  );
}
