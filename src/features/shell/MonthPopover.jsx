import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { formatMonthLabel, formatShortMonthLabel } from '../../shared/lib/format';
import { cn, focusRing } from '../../shared/ui/cn';
import PeriodSwitcher from './PeriodSwitcher';

/**
 * Mobile month picker: one 44px "Oct 2026" button that opens a popover with the full
 * previous/next switcher (48px targets). It stays open while stepping through months.
 */
export default function MonthPopover({ month, maxMonth, onChange }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Cambiar mes: ${formatMonthLabel(month)}`}
        className={cn(
          'flex h-11 shrink-0 items-center gap-1 rounded-sm border border-border-strong bg-surface px-3 text-sm font-medium whitespace-nowrap text-ink tabular-nums hover:bg-surface-2 aria-expanded:border-accent aria-expanded:bg-accent-soft',
          focusRing,
        )}
      >
        {formatShortMonthLabel(month)}
        <ChevronDown size={16} aria-hidden="true" className="text-ink-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="Elegir mes"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(320px,calc(100vw-32px))] rounded-md border border-border bg-surface p-3 shadow-[0_12px_32px_rgba(15,26,21,.16)] outline-none"
        >
          <PeriodSwitcher touch month={month} maxMonth={maxMonth} onChange={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
