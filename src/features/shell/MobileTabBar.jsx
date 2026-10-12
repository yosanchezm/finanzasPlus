import { useState } from 'react';
import { Ellipsis, Plus } from 'lucide-react';
import { DialogRoot, DialogTrigger } from '../../shared/ui/Dialog';
import { cn, focusRing } from '../../shared/ui/cn';
import MoreSheet from './MoreSheet';
import { navItem } from './navItems';

const TABS_LEFT = ['Resumen', 'Movimientos'].map(navItem);
const TABS_RIGHT = ['Presupuesto'].map(navItem);

const tabClass = cn(
  'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-sm text-xs font-medium text-ink-faint',
  'aria-[current=page]:text-accent aria-expanded:text-accent',
  focusRing,
);

export default function MobileTabBar({ activeView, onNavigate, onAdd, onOpenAssistant, onRefresh, onLogout, className }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const renderTab = ({ label, icon: Icon }) => (
    <button key={label} type="button" aria-current={activeView === label ? 'page' : undefined} onClick={() => onNavigate(label)} className={tabClass}>
      <Icon size={22} aria-hidden="true" />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );

  return (
    <DialogRoot open={sheetOpen} onOpenChange={setSheetOpen}>
      <nav
        aria-label="Navegación principal"
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 flex items-center border-t border-border bg-surface px-2 pt-1.5',
          'pb-[calc(6px+env(safe-area-inset-bottom))]',
          className,
        )}
      >
        {TABS_LEFT.map(renderTab)}
        <button
          type="button"
          aria-label="Nuevo movimiento"
          onClick={onAdd}
          className={cn('mx-1.5 grid size-[52px] shrink-0 place-items-center rounded-lg bg-accent text-white shadow-[0_6px_16px_rgba(11,110,79,.3)] hover:bg-accent-hover', focusRing)}
        >
          <Plus size={24} strokeWidth={2.25} aria-hidden="true" />
        </button>
        {TABS_RIGHT.map(renderTab)}
        <DialogTrigger asChild>
          <button type="button" className={tabClass}>
            <Ellipsis size={22} aria-hidden="true" />
            <span>Más</span>
          </button>
        </DialogTrigger>
      </nav>

      <MoreSheet
        onClose={() => setSheetOpen(false)}
        onNavigate={onNavigate}
        onOpenAssistant={onOpenAssistant}
        onRefresh={onRefresh}
        onLogout={onLogout}
      />
    </DialogRoot>
  );
}
