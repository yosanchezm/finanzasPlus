import { useId } from 'react';
import { ArrowDownLeft, ArrowUpRight, PiggyBank, Wallet } from 'lucide-react';
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

const BASE_NOTES = { reference: 'Base: ingreso del mes anterior', none: 'Sin ingreso de referencia' };
const NO_INCOME = 'Sin ingresos este mes';
const bpToPercent = (bp) => bp / 100;

const Note = ({ children }) => <p className="text-[13px] text-ink-muted tabular-nums">{children}</p>;

export function KpiCards({ budgetMonth, incomeCount, expenseCount, history = [] }) {
  const { totals, rates, base, warnings } = budgetMonth;
  const { plannedMinor, spentMinor } = totals.budgetUsed;
  const used = totals.budgetUsedRatio == null ? null : totals.budgetUsedRatio * 100;
  const free = plannedMinor - spentMinor;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const previousMonth = previous?.month;
  const saved = totals.savingMinor + totals.investmentMinor;
  const baseNote = BASE_NOTES[base.source] ? <Note>{BASE_NOTES[base.source]}</Note> : null;
  const overAllocated = warnings.some((warning) => warning.code === 'over_allocated');

  return (
    <section aria-label="Indicadores del mes" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <KpiCard label="Balance del mes" aside={<Wallet size={18} aria-hidden="true" className="text-accent" />} value={formatSignedMoney(totals.balanceMinor)}>
        <Note>Incluye ahorro, inversión y pagos de deuda</Note>
        {previous && <Delta current={totals.balanceMinor} previous={previous.income - previous.expenses} previousMonth={previousMonth} mode="amount" />}
      </KpiCard>
      <KpiCard label="Ingresos" aside={<ArrowDownLeft size={18} aria-hidden="true" className="text-accent" />} value={formatMoney(totals.incomeMinor)}>
        <Note>{movements(incomeCount)}</Note>
        {previous && <Delta current={totals.incomeMinor} previous={previous.income} previousMonth={previousMonth} />}
      </KpiCard>
      <KpiCard label="Gastos (consumo)" aside={<ArrowUpRight size={18} aria-hidden="true" className="text-ink-muted" />} value={formatMoney(totals.consumptionMinor)}>
        <Note>{movements(expenseCount)}</Note>
        {previous && <Delta current={totals.consumptionMinor} previous={previous.consumption} previousMonth={previousMonth} goodWhen="down" />}
      </KpiCard>
      <KpiCard label="Ahorro e inversión" aside={<PiggyBank size={18} aria-hidden="true" className="text-accent" />} value={formatMoney(saved)}>
        <Note>Ahorro {formatMoney(totals.savingMinor)} · Inversión {formatMoney(totals.investmentMinor)}</Note>
      </KpiCard>
      <KpiCard label="Tasa de ahorro" value={rates.savingsRateBp == null ? '—' : formatPercent(bpToPercent(rates.savingsRateBp))}>
        {rates.savingsRateBp == null ? <Note>{NO_INCOME}</Note> : <Note>del ingreso del mes</Note>}
        {rates.savingsRateBp == null && baseNote}
      </KpiCard>
      <KpiCard label="Deudas (% del ingreso)" value={rates.debtShareBp == null ? '—' : formatPercent(bpToPercent(rates.debtShareBp))}>
        {rates.debtShareBp == null ? <Note>{NO_INCOME}</Note> : <Note>{formatMoney(totals.debtMinor)} en pagos de deuda</Note>}
        {rates.debtShareBp == null && baseNote}
      </KpiCard>
      <KpiCard
        label="Presupuesto usado"
        aside={used == null ? null : <span className={cn('font-semibold tabular-nums', used > 100 ? 'text-danger' : 'text-ink-2')}>{formatPercent(used)}</span>}
        value={used == null ? '—' : (
          <>
            <span className={free < 0 ? 'text-danger' : undefined}>{formatMoney(Math.abs(free))}</span>{' '}
            <span className="text-sm font-medium tracking-normal text-ink-muted">{free < 0 ? 'excedidos' : 'libres'}</span>
          </>
        )}
      >
        {used == null
          ? <Note>Sin presupuesto definido</Note>
          : <ProgressBar value={used} tone={used > 100 ? 'danger' : 'accent'} size="sm" />}
      </KpiCard>
      <KpiCard label="Por asignar" value={<span className={overAllocated ? 'text-danger' : undefined}>{formatSignedMoney(totals.porAsignarMinor)}</span>}>
        {overAllocated ? <Note>Asignaste más de lo que ingresa</Note> : <Note>Ingreso menos lo presupuestado</Note>}
        {baseNote}
      </KpiCard>
      <p className="col-span-full text-[13px] text-ink-muted">
        Gastos cuenta solo consumo (necesidades y gustos). Una compra con tarjeta de crédito cuenta al comprar y otra vez al pagar la tarjeta: se registra dos veces.
      </p>
    </section>
  );
}
