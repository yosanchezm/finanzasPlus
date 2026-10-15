import { useEffect, useId, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { Button } from '../../shared/ui/Button';
import { cn, focusRing } from '../../shared/ui/cn';

// Plan-change actions of the debt detail. An item shows only when its handler is wired, so each slice adds its own;
// a card never offers "Reestructurar".
const ITEMS = [
  { handler: 'onRateChange', label: 'Cambiar tasa' },
  { handler: 'onChargeChange', label: 'Cambiar seguros y cargos' },
  { handler: 'onLatePolicy', label: 'Configurar mora' },
  { handler: 'onTermsCorrection', label: 'Corregir datos' },
  { handler: 'onRestructure', label: 'Reestructurar', loansOnly: true },
];

/**
 * "Más acciones": a small disclosure menu (AD17), without a dependency. The trigger has `aria-haspopup`; Escape, a click
 * outside or Tab close it, and the arrow keys, Home and End move through the items. Picking an item gives the focus back
 * to the trigger before running the action, so the dialog it opens returns the focus to a control that still exists.
 * Props: `isCard`, and `onRateChange`, `onChargeChange`, `onLatePolicy`, `onTermsCorrection`, `onRestructure`. With no handler it renders nothing.
 */
export default function MoreActionsMenu({ isCard = false, ...handlers }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const itemRefs = useRef([]);
  const menuId = useId();
  const items = ITEMS.filter((item) => handlers[item.handler] && !(isCard && item.loansOnly));

  useEffect(() => {
    if (!open) return undefined;
    itemRefs.current[0]?.focus();
    const closeOutside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  if (items.length === 0) return null;

  const focusItem = (index) => itemRefs.current[(index + items.length) % items.length]?.focus();
  const onKeyDown = (event) => {
    const at = itemRefs.current.indexOf(document.activeElement);
    const moves = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      focusItem(moves[event.key]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };
  const choose = (handler) => {
    trigger.current?.focus();
    setOpen(false);
    handlers[handler]();
  };

  return (
    <div ref={root} className="relative">
      <Button ref={trigger} variant="secondary" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((value) => !value)}>
        <Ellipsis size={16} aria-hidden="true" />Más acciones
      </Button>
      {open && (
        <div id={menuId} role="menu" aria-label="Más acciones" onKeyDown={onKeyDown} className="absolute top-full left-0 z-30 mt-1 flex min-w-60 flex-col rounded-sm border border-border-strong bg-surface p-1 shadow-[0_12px_32px_rgba(15,26,21,.18)] sm:right-0 sm:left-auto">
          {items.map((item, index) => (
            <button
              key={item.handler}
              ref={(node) => { itemRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => choose(item.handler)}
              className={cn('flex h-11 items-center rounded-sm px-3 text-left text-sm font-medium text-ink hover:bg-surface-2 focus-visible:bg-surface-2', focusRing)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
