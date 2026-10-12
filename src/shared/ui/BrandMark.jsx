import { Plus } from 'lucide-react';
import { cn } from './cn';

/**
 * The "+" square. `tone="mint"` sits on dark surfaces, `tone="dark"` on light ones.
 */
export function BrandMark({ tone = 'dark', size = 32, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-sm',
        tone === 'mint' ? 'bg-brand-mint text-sidebar' : 'bg-sidebar text-brand-mint',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Plus size={Math.round(size * 0.56)} strokeWidth={2.5} />
    </span>
  );
}

/** Brand mark plus the "finanzas+" wordmark. `tone="light"` for dark backgrounds. */
export function BrandLockup({ tone = 'dark', className }) {
  const onDark = tone === 'light';
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark tone={onDark ? 'mint' : 'dark'} />
      <span className={cn('text-[17px] font-semibold tracking-[-0.3px]', onDark ? 'text-white' : 'text-ink')}>
        finanzas<span className={onDark ? 'text-brand-mint' : 'text-accent'}>+</span>
      </span>
    </span>
  );
}
