import { cn } from './cn';

/**
 * Square icon tile. With `color`, the background is a light tint of it and the icon stays dark,
 * so pale stored category colors keep enough contrast.
 */
export function IconTile({ icon: Icon, color, size = 36, tone = 'accent', className }) {
  const tinted = color ? { backgroundColor: `color-mix(in srgb, ${color} 18%, white)` } : undefined;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-sm',
        color ? 'text-ink-2' : tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent',
        className,
      )}
      style={{ width: size, height: size, ...tinted }}
    >
      <Icon size={Math.round(size / 2)} />
    </span>
  );
}
