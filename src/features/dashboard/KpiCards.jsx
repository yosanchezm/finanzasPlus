import { useId } from 'react';
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react';
import { formatMoney, formatMonthName, formatPercent, formatSignedMoney } from '../../shared/lib/format';
import { computeDelta } from '../../shared/lib/monthly';
import { Card } from '../../shared/ui/Card';
import { ProgressBar } from '../../shared/ui/ProgressBar';
import { cn } from '../../shared/ui/cn';

const MINUS = '−';
const movements = (count) => (count === 1 ? '1 movimiento' : `${count} movimientos`);

/**
 * "+30 % vs. septiembre". Percentages need a non-zero previous value; otherwise (and for the balance,
 * which can be negative) the absolute difference is shown. Accent marks the favourable direction only.
 */
function Delta({ current, previous, previousMonth, mode = 'percent', goodWhen = 'up' }) {
  if (!previousMonth) return null;
  const monthName = formatMonthName(previousMonth).toLowerCase();
  const { difference, percent } = computeDelta(current, previous);
  if (difference === 0) return <p className="text-[13px] text-ink-muted">Igual que {monthName}</p>;

  const sign = difference > 0 ? '+' : MINUS;
  const change = mode === 'percent' && percent !== null
    ? `${sign}${formatPercent(Math.abs(percent))}`
    : `${sign} ${formatMoney(Math.abs(difference))}`;
  const favourable = goodWhen === 'up' ? difference > 0 : difference < 0;

  return (
    <p className="text-[13px] text-ink-muted tabular-nums">
      <span className={cn('font-semibold', favourable ? 'text-accent' : 'text-ink-2')}>{change}</span> vs. {monthName}
    </p>
  );
}

function KpiCard({ label, aside, value, children }) {
  const labelId = useId();
  return (
    <Card as="article" aria-labelledby={labelId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-ink-muted">
        <span id={labelId}>{label}</span>
        {aside}
      </div>
      <div className="text-[28px] leading-[34px] font-semibold tracking-[-0.7px] text-ink tabular-nums">{value}</div>
      {children}
    </Card>
  );
}

export function KpiCards({ totals, incomeCount, expenseCount, budget, history = [] }) {
  const balance = totals.income - totals.expenses;
  const used = budget.planned ? (budget.spent / budget.planned) * 100 : 0;
  const free = budget.planned - budget.spent;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const previousMonth = previous?.month;

  return (
    <section aria-label="Indicadores del mes" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <KpiCard label="Balance del mes" aside={<Wallet size={18} aria-hidden="true" className="text-accent" />} value={formatSignedMoney(balance)}>
        {previous
          ? <Delta current={balance} previous={previous.income - previous.expenses} previousMonth={previousMonth} mode="amount" />
          : <p className="text-[13px] text-ink-muted">Ingresos menos gastos</p>}
      </KpiCard>
      <KpiCard label="Ingresos" aside={<ArrowDownLeft size={18} aria-hidden="true" className="text-accent" />} value={formatMoney(totals.income)}>
        <p className="text-[13px] text-ink-muted tabular-nums">{movements(incomeCount)}</p>
        {previous && <Delta current={totals.income} previous={previous.income} previousMonth={previousMonth} />}
      </KpiCard>
      <KpiCard label="Gastos" aside={<ArrowUpRight size={18} aria-hidden="true" className="text-ink-muted" />} value={formatMoney(totals.expenses)}>
        <p className="text-[13px] text-ink-muted tabular-nums">{movements(expenseCount)}</p>
        {previous && <Delta current={totals.expenses} previous={previous.expenses} previousMonth={previousMonth} goodWhen="down" />}
      </KpiCard>
      <KpiCard
        label="Presupuesto usado"
        aside={budget.planned ? <span className={cn('font-semibold tabular-nums', used > 100 ? 'text-danger' : 'text-ink-2')}>{formatPercent(used)}</span> : null}
        value={budget.planned ? (
          <>
            <span className={free < 0 ? 'text-danger' : undefined}>{formatMoney(Math.abs(free))}</span>{' '}
            <span className="text-sm font-medium tracking-normal text-ink-muted">{free < 0 ? 'excedidos' : 'libres'}</span>
          </>
        ) : '—'}
      >
        {budget.planned
          ? <ProgressBar value={used} tone={used > 100 ? 'danger' : 'accent'} size="sm" />
          : <p className="text-[13px] text-ink-muted">Sin presupuesto definido</p>}
      </KpiCard>
    </section>
  );
}
