import { cn, focusRing } from './cn';

/**
 * A role="group" of toggle buttons with aria-pressed. Name it with `label` or `labelledBy`.
 * `fill` stretches the segments to equal widths.
 */
export function SegmentedControl({ label, labelledBy, options, value, onChange, fill = false, size = 'md', className }) {
  return (
    <div
      role="group"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className={cn('gap-0.5 rounded-[10px] bg-[#e9ece8] p-[3px]', fill ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex', className)}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[7px] px-3 font-medium whitespace-nowrap text-ink-muted transition-colors hover:text-ink',
              size === 'lg' ? 'h-9 text-sm' : 'h-[34px] text-[13px]',
              pressed && 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(16,24,20,.08)]',
              focusRing,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
