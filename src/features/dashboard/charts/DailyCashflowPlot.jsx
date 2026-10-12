import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatShort } from '../../../shared/lib/format';
import { AXIS_TICK, EXPENSE_COLOR, GRID_COLOR, INCOME_COLOR, TOOLTIP_STYLE } from './chartTheme';

/** Recharts body of the daily cumulative chart. Loaded lazily; the text alternative lives outside. */
export default function DailyCashflowPlot({ series }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#D5DBD6' }} minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value) => formatShort(value)} />
        <Tooltip formatter={(value) => formatMoney(value)} labelFormatter={(day) => `Día ${day}`} contentStyle={TOOLTIP_STYLE} />
        <Line type="monotone" dataKey="income" name="Ingresos" stroke={INCOME_COLOR} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="expenses" name="Gastos" stroke={EXPENSE_COLOR} strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
