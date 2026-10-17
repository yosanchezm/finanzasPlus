import { formatMoney } from '../../../shared/lib/format';
import { EXPENSE_COLOR, INCOME_COLOR } from './chartTheme';

const SERIES = [
  { key: 'income', name: 'Ingresos', color: INCOME_COLOR },
  { key: 'expenses', name: 'Gastos', color: EXPENSE_COLOR },
];

function Row({ color, name, value, strong }) {
  return (
    <div className="flex items-center gap-2">
      {color ? <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : <span aria-hidden="true" className="w-3 shrink-0" />}
      <span className={strong ? 'font-semibold text-ink tabular-nums' : 'font-medium text-ink tabular-nums'}>{value}</span>
      <span className="text-ink-muted">{name}</span>
    </div>
  );
}

/**
 * One readout for every series at the hovered point, plus the balance (income minus expenses).
 * Values lead and names follow; series are keyed with a short stroke of their color.
 */
export default function CashflowTooltip({ active, payload, label, labelFormatter, hidden = {} }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const balance = Number(point.income || 0) - Number(point.expenses || 0);
  return (
    <div className="flex min-w-40 flex-col gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-[13px] shadow-sm">
      <span className="text-xs text-ink-muted">{labelFormatter ? labelFormatter(label) : label}</span>
      {SERIES.filter((series) => !hidden[series.key]).map((series) => (
        <Row key={series.key} color={series.color} name={series.name} value={formatMoney(point[series.key])} />
      ))}
      <div className="mt-0.5 border-t border-border pt-1.5">
        <Row name="Balance" value={`${balance < 0 ? '−' : '+'} ${formatMoney(Math.abs(balance))}`} strong />
      </div>
    </div>
  );
}
