import { Button } from './Button';
import { DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from './Dialog';

/**
 * Confirmation step. Controlled: render with `open`, close via onOpenChange(false).
 * `confirmVariant` is 'danger' for destructive actions, 'primary' otherwise.
 */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, confirmVariant = 'danger' }) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="confirm" role="alertdialog" className="gap-4 p-6">
        <div className="flex flex-col gap-2">
          <DialogTitle className="text-lg font-semibold tracking-[-0.3px]">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-[22px] text-ink-muted">{description}</DialogDescription>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
