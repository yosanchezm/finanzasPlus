import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { cn } from '../../shared/ui/cn';
import PeriodSwitcher from './PeriodSwitcher';
import TopbarSearch from './TopbarSearch';

export default function Topbar({
  householdName, activeView, month, maxMonth, onMonthChange, onSearch, onAdd, onRefresh, refreshing = false, showPeriod = true, className,
}) {
  return (
    <header className={cn('sticky top-0 z-10 h-16 items-center gap-3 border-b border-border bg-surface px-8', className)}>
      <nav aria-label="Ruta" className="flex min-w-0 shrink items-center gap-2 text-sm text-ink-faint">
        <span className="truncate">{householdName}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="font-semibold whitespace-nowrap text-ink">{activeView}</span>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <TopbarSearch onSearch={onSearch} className="w-[200px] xl:w-[280px]" />
        {showPeriod && <PeriodSwitcher month={month} maxMonth={maxMonth} onChange={onMonthChange} />}
        <Button
          variant="secondary"
          size="icon"
          aria-label="Actualizar datos"
          title="Actualizar datos"
          aria-busy={refreshing}
          onClick={onRefresh}
          className="text-ink-2"
        >
          <RefreshCw size={18} aria-hidden="true" className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />
        </Button>
        <Button onClick={onAdd}>
          <Plus size={16} strokeWidth={2.25} aria-hidden="true" />
          Nuevo movimiento
        </Button>
      </div>
    </header>
  );
}
