/** View title (24/32 semibold), muted subtitle, and actions that wrap on narrow screens. */
export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.5px] text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
