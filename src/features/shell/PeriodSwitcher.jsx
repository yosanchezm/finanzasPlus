import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths } from '../../shared/lib/dates';
import { formatMonthLabel } from '../../shared/lib/format';
import { cn, focusRing } from '../../shared/ui/cn';

/**
 * Previous / next month control. Months after `maxMonth` (the current month) are not reachable.
 * `touch` enlarges every target to 48px for the mobile month popover.
 */
export default function PeriodSwitcher({ month, maxMonth, onChange, touch = false, className }) {
  const canGoNext = month < maxMonth;
  const arrow = cn(
    'grid h-full shrink-0 place-items-center text-ink-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-border-strong disabled:hover:bg-transparent',
    touch ? 'w-12' : 'w-9',
    focusRing,
  );

  return (
    <div role="group" aria-label="Periodo" className={cn('flex items-stretch overflow-hidden rounded-sm border border-border-strong bg-surface', touch ? 'h-12' : 'h-10', className)}>
      <button type="button" aria-label="Mes anterior" title="Mes anterior" onClick={() => onChange(addMonths(month, -1))} className={cn(arrow, 'rounded-l-sm')}>
        <ChevronLeft size={touch ? 20 : 18} aria-hidden="true" />
      </button>
      <span aria-live="polite" className={cn('flex flex-1 items-center justify-center gap-2 border-x border-border px-3 font-medium whitespace-nowrap text-ink tabular-nums', touch ? 'text-base' : 'text-sm')}>
        <CalendarDays size={16} aria-hidden="true" className="text-ink-muted" />
        {formatMonthLabel(month)}
      </span>
      <button type="button" aria-label="Mes siguiente" title="Mes siguiente" disabled={!canGoNext} onClick={() => onChange(addMonths(month, 1))} className={cn(arrow, 'rounded-r-sm')}>
        <ChevronRight size={touch ? 20 : 18} aria-hidden="true" />
      </button>
    </div>
  );
}
