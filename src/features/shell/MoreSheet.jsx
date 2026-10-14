import { LogOut, RefreshCw, Sparkles } from 'lucide-react';
import { DialogContent, DialogTitle } from '../../shared/ui/Dialog';
import { cn, focusRing } from '../../shared/ui/cn';
import { SETTINGS_ITEM, navItem } from './navItems';

const GoalsIcon = navItem('Metas').icon;
const DebtsIcon = navItem('Deudas').icon;
const itemClass = cn('flex h-12 items-center gap-3 rounded-sm px-3 text-left text-base font-medium', focusRing);

/**
 * Bottom sheet with the secondary mobile actions. Must be rendered inside the DialogRoot
 * that MobileTabBar owns; Radix handles Escape, outside clicks, focus trap/return and scroll lock.
 */
export default function MoreSheet({ onClose, onNavigate, onOpenAssistant, onRefresh, onLogout }) {
  const run = (action) => () => { onClose(); action?.(); };

  const items = [
    { label: 'Metas', icon: GoalsIcon, action: () => onNavigate('Metas') },
    { label: 'Deudas', icon: DebtsIcon, action: () => onNavigate('Deudas') },
    { label: SETTINGS_ITEM.label, icon: SETTINGS_ITEM.icon, action: () => onNavigate(SETTINGS_ITEM.label) },
    { label: 'Nia', icon: Sparkles, action: onOpenAssistant },
    { label: 'Actualizar datos', icon: RefreshCw, action: onRefresh },
  ];

  return (
    <DialogContent
      variant="sheet"
      aria-describedby={undefined}
      className="gap-1 px-3 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))] lg:hidden"
      overlayClassName="lg:hidden"
      overlayProps={{ 'data-testid': 'more-sheet-backdrop' }}
    >
      <span aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong" />
      <DialogTitle className="px-3 pb-1 font-mono text-xs tracking-[1px] text-ink-faint uppercase">Más opciones</DialogTitle>
      {items.map(({ label, icon: Icon, action }) => (
        <button key={label} type="button" onClick={run(action)} className={cn(itemClass, 'text-ink hover:bg-surface-2')}>
          <Icon size={20} aria-hidden="true" className="text-ink-muted" />
          {label}
        </button>
      ))}
      <div className="my-1 border-t border-border" />
      <button type="button" onClick={run(onLogout)} className={cn(itemClass, 'text-danger hover:bg-danger-soft')}>
        <LogOut size={20} aria-hidden="true" />
        Cerrar sesión
      </button>
    </DialogContent>
  );
}
