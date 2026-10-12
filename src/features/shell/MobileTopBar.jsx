import { getInitials } from '../../shared/lib/initials';
import { Avatar } from '../../shared/ui/Avatar';
import { BrandMark } from '../../shared/ui/BrandMark';
import { cn } from '../../shared/ui/cn';
import PeriodSwitcher from './PeriodSwitcher';

export default function MobileTopBar({ householdName, displayName, month, maxMonth, onMonthChange, className }) {
  return (
    <header className={cn('sticky top-0 z-10 h-[60px] items-center gap-2.5 border-b border-border bg-surface px-4', className)}>
      <BrandMark size={28} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{householdName}</span>
      <PeriodSwitcher compact month={month} maxMonth={maxMonth} onChange={onMonthChange} className="shrink-0" />
      <Avatar initials={getInitials(displayName)} tone="accent" label={displayName} />
    </header>
  );
}
