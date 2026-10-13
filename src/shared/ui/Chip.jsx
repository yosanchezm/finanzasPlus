import { cn } from './cn';

const TONES = {
  you: 'bg-accent-soft text-accent',
  partner: 'bg-partner-soft text-partner',
  shared: 'bg-shared-soft text-shared',
  danger: 'bg-danger-soft text-[#9a3412]',
  neutral: 'bg-[#eef1ed] text-ink-2',
};

export function Chip({ tone = 'you', className, children }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Who a record belongs to, relative to the signed-in member. Goals use the feminine "Compartida". */
export function OwnerChip({ ownerScope, currentOwnerScope, feminine = false, className }) {
  if (ownerScope === 'shared') return <Chip tone="shared" className={className}>{feminine ? 'Compartida' : 'Compartido'}</Chip>;
  if (ownerScope === currentOwnerScope) return <Chip tone="you" className={className}>Tú</Chip>;
  return <Chip tone="partner" className={className}>Pareja</Chip>;
}
