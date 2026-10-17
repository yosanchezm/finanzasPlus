import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatShort } from '../../../shared/lib/format';
import CashflowTooltip from './CashflowTooltip';
import { AXIS_TICK, CROSSHAIR, EXPENSE_COLOR, GRID_COLOR, INCOME_COLOR } from './chartTheme';

const activeDot = (color) => ({ r: 4, fill: color, stroke: '#FFFFFF', strokeWidth: 2 });

/**
 * Recharts body of the daily cumulative chart. Loaded lazily; the text alternative lives outside.
 * A crosshair snaps to the nearest day and the readout lists both series and the balance.
 */
export default function DailyCashflowPlot({ series, hidden = {} }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#D5DBD6' }} minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(value) => formatShort(value)} />
        <Tooltip content={<CashflowTooltip labelFormatter={(day) => `Día ${day}`} hidden={hidden} />} cursor={CROSSHAIR} />
        <Line type="monotone" dataKey="income" name="Ingresos" stroke={INCOME_COLOR} hide={hidden.income} strokeWidth={2} dot={false} activeDot={activeDot(INCOME_COLOR)} isAnimationActive={false} />
        <Line type="monotone" dataKey="expenses" name="Gastos" stroke={EXPENSE_COLOR} hide={hidden.expenses} strokeWidth={2} dot={false} activeDot={activeDot(EXPENSE_COLOR)} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
