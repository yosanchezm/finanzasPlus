import { cn } from './cn';

/** White card: 1px border, radius 12, padding 20. Pass `padded={false}` for edge-to-edge content. */
export function Card({ as: Component = 'section', padded = true, className, children, ...props }) {
  return (
    <Component className={cn('min-w-0 rounded-md border border-border bg-surface', padded && 'p-5', className)} {...props}>
      {children}
    </Component>
  );
}

/** Card title row with an optional subtitle and trailing action. */
export function CardHeader({ title, titleId, subtitle, action, className }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
        {subtitle && <span className="text-[13px] text-ink-muted">{subtitle}</span>}
      </div>
      {action}
    </div>
  );
}
