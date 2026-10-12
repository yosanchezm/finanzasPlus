import { LogOut, SlidersHorizontal, Sparkles } from 'lucide-react';
import { getInitials } from '../../shared/lib/initials';
import { Avatar } from '../../shared/ui/Avatar';
import { BrandLockup } from '../../shared/ui/BrandMark';
import { cn, focusRingDark } from '../../shared/ui/cn';
import { NAV_ITEMS } from './navItems';

const itemClass = cn(
  'flex h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-sm font-medium text-sidebar-text transition-colors',
  'hover:bg-white/6 hover:text-[#f2f6f3]',
  'aria-[current=page]:bg-brand-mint/12 aria-[current=page]:text-brand-mint',
  focusRingDark,
);

function SectionLabel({ children, className }) {
  return <span className={cn('px-3 pb-2 font-mono text-xs tracking-[1px] text-sidebar-label uppercase', className)}>{children}</span>;
}

export default function Sidebar({
  householdName, members = [], displayName, email, activeView, transactionsCount = 0,
  onNavigate, onOpenAssistant, onLogout, className,
}) {
  return (
    <aside className={cn('sticky top-0 h-dvh w-[248px] shrink-0 flex-col gap-6 overflow-y-auto bg-sidebar px-3 py-5', className)}>
      <BrandLockup tone="light" className="px-2 py-1" />

      <div className="flex h-[52px] items-center gap-2.5 rounded-[10px] border border-sidebar-line bg-sidebar-raised px-2.5 text-[#e7eeea]">
        <span className="flex">
          {members.slice(0, 2).map((member, index) => (
            <Avatar
              key={member.$id}
              size={24}
              initials={(member.alias || '?').slice(0, 1).toUpperCase()}
              tone={index === 0 ? 'mint' : 'partner'}
              className={cn('border-2 border-sidebar-raised', index > 0 && '-ml-1.5')}
            />
          ))}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">{householdName}</span>
          <span className="text-xs text-sidebar-text">{members.length} integrantes</span>
        </span>
      </div>

      <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
        <SectionLabel>General</SectionLabel>
        {NAV_ITEMS.map(({ label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            aria-current={activeView === label ? 'page' : undefined}
            onClick={() => onNavigate(label)}
            className={itemClass}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
            {label === 'Movimientos' && <span className="ml-auto text-xs text-sidebar-text tabular-nums">{transactionsCount}</span>}
          </button>
        ))}

        <SectionLabel className="pt-5">Asistente</SectionLabel>
        <button type="button" onClick={onOpenAssistant} className={itemClass}>
          <Sparkles size={18} aria-hidden="true" />
          <span>Nia</span>
        </button>
      </nav>

      <div className="mt-auto flex flex-col gap-0.5">
        <button type="button" disabled className={cn(itemClass, 'cursor-not-allowed opacity-70 hover:bg-transparent hover:text-sidebar-text')}>
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>Ajustes</span>
          <span className="ml-auto rounded-sm bg-white/6 px-1.5 py-0.5 text-xs text-sidebar-label">Próximamente</span>
        </button>

        <div className="mt-2.5 flex items-center gap-2.5 border-t border-sidebar-line px-2 pt-3">
          <Avatar initials={getInitials(displayName)} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[13px] font-semibold text-[#e7eeea]">{displayName}</span>
            <span className="truncate text-xs text-sidebar-text">{email}</span>
          </span>
          <button
            type="button"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            onClick={onLogout}
            className={cn('grid size-9 shrink-0 place-items-center rounded-sm text-sidebar-text hover:bg-white/6 hover:text-white', focusRingDark)}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
