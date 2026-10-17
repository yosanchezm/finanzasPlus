import { Cell, Pie, PieChart } from 'recharts';

const DIMMED = 0.3;

/**
 * Recharts donut. Loaded lazily; the legend next to it is the text alternative and the keyboard path.
 * Hovering a slice reports it (the card shows it in the center and dims the others); clicking selects it.
 */
export default function CategoryDonutPlot({ slices, size, activeKey, onHover, onSelect }) {
  return (
    <PieChart width={size} height={size} accessibilityLayer={false}>
      <Pie
        data={slices}
        dataKey="value"
        nameKey="name"
        innerRadius={size / 2 - 22}
        outerRadius={size / 2 - 2}
        startAngle={90}
        endAngle={-270}
        stroke="#FFFFFF"
        strokeWidth={2}
        isAnimationActive={false}
        onMouseEnter={(_, index) => onHover(slices[index]?.key ?? null)}
        onMouseLeave={() => onHover(null)}
        onClick={(_, index) => slices[index] && onSelect(slices[index])}
        style={{ cursor: 'pointer', outline: 'none' }}
      >
        {slices.map((slice) => (
          <Cell key={slice.key} fill={slice.color} fillOpacity={activeKey && activeKey !== slice.key ? DIMMED : 1} />
        ))}
      </Pie>
    </PieChart>
  );
}
