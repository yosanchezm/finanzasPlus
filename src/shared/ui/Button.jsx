import { cn, focusRing } from './cn';

const VARIANTS = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-accent/60',
  secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white hover:bg-[#9a3412]',
};

const SIZES = {
  md: 'h-10 px-3.5 text-sm',
  lg: 'h-[52px] px-4 text-base lg:h-11 lg:text-sm',
  icon: 'size-10',
};

export function Button({ variant = 'primary', size = 'md', type = 'button', className, children, ...props }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-sm font-semibold transition-colors disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
