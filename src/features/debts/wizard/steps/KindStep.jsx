import { IconTile } from '../../../../shared/ui/IconTile';
import { cn, focusRing } from '../../../../shared/ui/cn';
import { DEBT_KINDS } from '../../debtLabels';

export default function KindStep({ kind, onPick }) {
  return (
    <div role="group" aria-label="Tipo de deuda" className="flex flex-col gap-2">
      {DEBT_KINDS.map(({ value, label, hint, icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={kind === value}
          onClick={() => onPick(value)}
          className={cn(
            'flex min-h-14 items-center gap-3 rounded-md border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2',
            'aria-pressed:border-accent aria-pressed:bg-accent-soft',
            focusRing,
          )}
        >
          <IconTile icon={icon} size={36} />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-ink">{label}</span>
            <span className="text-[13px] text-ink-muted">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
