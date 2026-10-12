import { Cell, Pie, PieChart } from 'recharts';

/** Recharts donut. Loaded lazily; the legend list next to it is the text alternative. */
export default function CategoryDonutPlot({ items, size }) {
  return (
    <PieChart width={size} height={size} accessibilityLayer={false}>
      <Pie data={items} dataKey="value" nameKey="name" innerRadius={45} outerRadius={64} startAngle={90} endAngle={-270} stroke="#FFFFFF" strokeWidth={2} isAnimationActive={false}>
        {items.map((item) => <Cell key={item.$id} fill={item.color} />)}
      </Pie>
    </PieChart>
  );
}
