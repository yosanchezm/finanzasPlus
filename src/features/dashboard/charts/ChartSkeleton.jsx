import { cn } from '../../../shared/ui/cn';

/** Placeholder with the chart's exact footprint so the layout does not jump while the chart code loads. */
export function ChartSkeleton({ className, round = false }) {
  return <div aria-hidden="true" className={cn('animate-pulse bg-surface-2 motion-reduce:animate-none', round ? 'rounded-full' : 'rounded-sm', className)} />;
}
