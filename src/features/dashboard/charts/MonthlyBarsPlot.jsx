import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMonthLabel, formatShort } from '../../../shared/lib/format';
import CashflowTooltip from './CashflowTooltip';
import { AXIS_TICK, CURSOR_FILL, EXPENSE_COLOR, GRID_COLOR, INCOME_COLOR } from './chartTheme';

const shortMonth = (key) => {
  const text = new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(new Date(`${key}-01T12:00:00`)).replace('.', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * Recharts body of the 6-month income vs expenses bars. Loaded lazily; the text alternative lives outside.
 * The whole month column is the hit target: hovering it shows the readout, clicking it opens that month.
 */
export default function MonthlyBarsPlot({ history, hidden = {}, onSelectMonth }) {
  const selectMonth = (state) => {
    if (onSelectMonth && state?.activeLabel) onSelectMonth(String(state.activeLabel));
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={history}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="28%"
        accessibilityLayer={false}
        onClick={selectMonth}
        style={onSelectMonth ? { cursor: 'pointer' } : undefined}
      >
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#D5DBD6' }} tickFormatter={shortMonth} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value) => formatShort(value)} />
        <Tooltip content={<CashflowTooltip labelFormatter={formatMonthLabel} hidden={hidden} />} cursor={{ fill: CURSOR_FILL }} />
        <Bar dataKey="income" name="Ingresos" fill={INCOME_COLOR} hide={hidden.income} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="expenses" name="Gastos" fill={EXPENSE_COLOR} hide={hidden.expenses} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
