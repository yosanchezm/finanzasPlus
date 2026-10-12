import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths } from '../../shared/lib/dates';
import { formatMonthLabel, formatShortMonthLabel } from '../../shared/lib/format';
import { cn, focusRing } from '../../shared/ui/cn';

/**
 * Previous / next month control. Months after `maxMonth` (the current month) are not reachable.
 * `compact` is the mobile variant (short month name, no calendar icon).
 */
export default function PeriodSwitcher({ month, maxMonth, onChange, compact = false, className }) {
  const canGoNext = month < maxMonth;
  const arrow = cn(
    'grid h-full w-9 shrink-0 place-items-center text-ink-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-border-strong disabled:hover:bg-transparent',
    focusRing,
  );

  return (
    <div role="group" aria-label="Periodo" className={cn('flex h-10 items-stretch overflow-hidden rounded-sm border border-border-strong bg-surface', className)}>
      <button type="button" aria-label="Mes anterior" title="Mes anterior" onClick={() => onChange(addMonths(month, -1))} className={cn(arrow, 'rounded-l-sm')}>
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <span aria-live="polite" className={cn('flex items-center gap-2 border-x border-border px-3 text-sm font-medium whitespace-nowrap text-ink tabular-nums', compact && 'px-2 text-[13px]')}>
        {!compact && <CalendarDays size={16} aria-hidden="true" className="text-ink-muted" />}
        {compact ? formatShortMonthLabel(month) : formatMonthLabel(month)}
      </span>
      <button type="button" aria-label="Mes siguiente" title="Mes siguiente" disabled={!canGoNext} onClick={() => onChange(addMonths(month, 1))} className={cn(arrow, 'rounded-r-sm')}>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
