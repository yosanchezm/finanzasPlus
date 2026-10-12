import { useId } from 'react';
import { cn } from './cn';

/** Shared input look: 48px/16px on mobile (avoids iOS zoom), 44px/14px from lg. */
export const inputClass = cn(
  'h-12 w-full rounded-sm border border-border-strong bg-surface text-base text-ink placeholder:text-ink-faint/80 lg:h-11 lg:text-sm',
  'outline-none focus:border-accent focus:ring-3 focus:ring-accent/15',
);

export const labelClass = 'text-sm font-medium text-ink-2 lg:text-[13px]';

/**
 * Labelled input with an optional leading icon and trailing control
 * (e.g. a show/hide button).
 */
export function TextField({ label, icon: Icon, trailing, className, inputClassName, ...inputProps }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="relative">
        {Icon && <Icon aria-hidden="true" size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint" />}
        <input
          id={id}
          className={cn(inputClass, Icon ? 'pl-10' : 'pl-3', trailing ? 'pr-12' : 'pr-3', inputClassName)}
          {...inputProps}
        />
        {trailing && <div className="absolute top-1/2 right-1 -translate-y-1/2">{trailing}</div>}
      </div>
    </div>
  );
}

/** Labelled native select with the same look as TextField. */
export function SelectField({ label, className, children, ...selectProps }) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} className={cn(inputClass, 'px-3')} {...selectProps}>{children}</select>
    </div>
  );
}
