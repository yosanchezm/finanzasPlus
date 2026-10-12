import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMonthLabel, formatShort } from '../../../shared/lib/format';
import { AXIS_TICK, EXPENSE_COLOR, GRID_COLOR, INCOME_COLOR, TOOLTIP_STYLE } from './chartTheme';

const shortMonth = (key) => {
  const text = new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(new Date(`${key}-01T12:00:00`)).replace('.', '');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Recharts body of the 6-month income vs expenses bars. Loaded lazily; the text alternative lives outside. */
export default function MonthlyBarsPlot({ history }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={4} barCategoryGap="28%" accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#D5DBD6' }} tickFormatter={shortMonth} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value) => formatShort(value)} />
        <Tooltip formatter={(value) => formatMoney(value)} labelFormatter={formatMonthLabel} contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#F4F5F2' }} />
        <Bar dataKey="income" name="Ingresos" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="expenses" name="Gastos" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
