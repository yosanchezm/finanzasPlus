import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn, focusRing } from './cn';

export const DialogRoot = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

const VARIANTS = {
  // Near full-height bottom sheet below 640px; centered 480px card from sm.
  center: cn(
    'inset-x-0 top-3 bottom-0 rounded-t-lg',
    'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-48px)] sm:w-[480px] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg',
  ),
  // Bottom sheet on mobile; right-side 400px sheet from sm.
  side: cn(
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg',
    'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[400px] sm:rounded-none sm:border-l sm:border-border',
  ),
  // Small centered confirmation.
  confirm: 'top-1/2 left-1/2 w-[calc(100vw-32px)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-lg',
  // Plain bottom sheet at every size (callers hide it where it does not apply).
  sheet: 'inset-x-0 bottom-0 rounded-t-lg',
};

/** Portal + overlay + content. Radix provides focus trap, Escape, scroll lock and aria-modal. */
export function DialogContent({ variant = 'center', className, overlayClassName, overlayProps, children, ...props }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={cn('fixed inset-0 z-50 bg-sidebar/50', overlayClassName)} {...overlayProps} />
      <RadixDialog.Content
        className={cn(
          'fixed z-50 flex flex-col bg-surface text-ink shadow-[0_24px_64px_rgba(15,26,21,.28)] outline-none',
          VARIANTS[variant],
          className,
        )}
        {...props}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** Title row with a close button. */
export function DialogHeader({ title, description, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-6 pt-5', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <RadixDialog.Title className="text-lg font-semibold tracking-[-0.3px] text-ink">{title}</RadixDialog.Title>
        {description && <RadixDialog.Description className="text-sm text-ink-muted">{description}</RadixDialog.Description>}
      </div>
      <RadixDialog.Close
        aria-label="Cerrar"
        className={cn('grid size-9 shrink-0 place-items-center rounded-sm text-ink-muted hover:bg-surface-2 hover:text-ink', focusRing)}
      >
        <X size={18} aria-hidden="true" />
      </RadixDialog.Close>
    </div>
  );
}
