import { Receipt } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';
import { IconTile } from './IconTile';

/** Icon tile, a 14px message and an optional secondary action. */
export function EmptyState({ icon = Receipt, message, actionLabel, onAction, actionIcon: ActionIcon, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-4 py-10 text-center', className)}>
      <IconTile icon={icon} size={44} />
      <p className="max-w-xs text-sm leading-[22px] text-ink-muted">{message}</p>
      {onAction && (
        <Button variant="secondary" onClick={onAction}>
          {ActionIcon && <ActionIcon size={16} aria-hidden="true" />}
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
