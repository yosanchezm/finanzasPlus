import { useId } from 'react';
import { Receipt } from 'lucide-react';
import { formatDate, formatTransactionAmount } from '../../shared/lib/format';
import { OwnerChip } from '../../shared/ui/Chip';
import { IconTile } from '../../shared/ui/IconTile';
import { cn, focusRing } from '../../shared/ui/cn';

/**
 * One transaction as a list row: icon, concept, "Categoría · fecha", owner, signed amount, optional actions.
 * With `onOpen`, everything except the actions is one button that opens the detail.
 */
export function TransactionRow({ item, currentOwnerScope, actions, onOpen, className }) {
  const detailsId = useId();
  const isIncome = item.type === 'income';
  const content = (
    <>
      <IconTile icon={item.icon || Receipt} color={item.categoryColor} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-ink">{item.merchant}</span>
        <span id={detailsId} className="truncate text-[13px] text-ink-faint">{item.categoryName || 'Sin categoría'} · {formatDate(item.occurredAt)}</span>
      </span>
      <OwnerChip ownerScope={item.ownerScope} currentOwnerScope={currentOwnerScope} className="hidden sm:inline-flex" />
      <span className={cn('shrink-0 text-right text-sm font-semibold tabular-nums sm:w-[120px]', isIncome ? 'text-accent' : 'text-ink')}>
        {formatTransactionAmount(item)}
      </span>
    </>
  );

  return (
    <li className={cn('flex items-center gap-1 rounded-sm hover:bg-surface-2', className)}>
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(item)}
          aria-label={`Ver detalle de ${item.merchant}`}
          aria-describedby={detailsId}
          aria-haspopup="dialog"
          className={cn('flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-sm px-3 py-2.5 text-left', focusRing)}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">{content}</div>
      )}
      {actions}
    </li>
  );
}
