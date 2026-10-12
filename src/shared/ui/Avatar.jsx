import { cn } from './cn';

const TONES = {
  mint: 'bg-brand-mint text-sidebar',
  accent: 'bg-accent text-white',
  partner: 'bg-partner-soft text-partner',
};

/** Round initials badge. Decorative by default; pass `label` to expose it. */
export function Avatar({ initials, tone = 'mint', size = 32, label, className }) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
      className={cn('grid shrink-0 place-items-center rounded-full text-xs font-semibold', TONES[tone], className)}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}
