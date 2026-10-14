import { useId } from 'react';
import { Chip } from '../../shared/ui/Chip';

/** Native checkbox with its label, 44px tall for touch. The hint describes it without joining its name. */
export function CheckField({ label, hint, checked, onChange }) {
  const hintId = useId();
  return (
    <div className="flex min-h-11 items-start gap-2.5 py-2.5">
      <input id={`${hintId}-box`} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-accent" checked={checked} aria-describedby={hint ? hintId : undefined} onChange={(event) => onChange(event.target.checked)} />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={`${hintId}-box`} className="text-sm text-ink-2">{label}</label>
        {hint && <span id={hintId} className="text-[13px] text-ink-muted">{hint}</span>}
      </div>
    </div>
  );
}

/** Inline validation message tied to its input through `id`. */
export function FieldError({ id, children }) {
  if (!children) return null;
  return <p id={id} className="text-[13px] text-danger">{children}</p>;
}

/** Row badges from the model (`{ tone, text }`). */
export function Badges({ badges }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => <Chip key={badge.text} tone={badge.tone}>{badge.text}</Chip>)}
    </span>
  );
}

/** Label of the submit button: it says what is happening and what a failed save asks for. */
export const saveLabel = (saveState, idleLabel) => {
  if (saveState.status === 'saving') return 'Guardando…';
  return saveState.status === 'error' ? 'Reintentar' : idleLabel;
};

/** Shown under the form after a failed save; the typed values stay in place. */
export function SaveError({ saveState }) {
  if (saveState.status !== 'error') return null;
  return <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2.5 text-[13px] text-[#9a3412]">{saveState.error}</p>;
}
