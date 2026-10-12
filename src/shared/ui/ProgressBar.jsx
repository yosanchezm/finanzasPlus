import { cn } from './cn';

/** Decorative bar; always pair it with a visible percentage. `color` overrides the tone. */
export function ProgressBar({ value, tone = 'accent', color, size = 'md', className }) {
  const width = Math.max(0, Math.min(Number(value) || 0, 100));
  return (
    <div aria-hidden="true" className={cn('overflow-hidden rounded-full bg-[#e9ece8]', size === 'lg' ? 'h-2.5' : size === 'sm' ? 'h-1.5' : 'h-2', className)}>
      <div
        className={cn('h-full rounded-full', !color && (tone === 'danger' ? 'bg-danger' : 'bg-accent'))}
        style={{ width: `${width}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}
