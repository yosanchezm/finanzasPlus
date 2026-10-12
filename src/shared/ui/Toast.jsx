import { Check } from 'lucide-react';

/**
 * Always-mounted live region so screen readers announce changes.
 * Bottom-right on desktop; above the mobile tab bar below lg.
 */
export function Toast({ message }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[60] flex justify-center lg:inset-x-auto lg:right-6 lg:bottom-6"
    >
      {message && (
        <div className="flex max-w-sm items-center gap-2 rounded-sm bg-sidebar px-4 py-3 text-sm font-medium text-white shadow-[0_12px_32px_rgba(15,26,21,.24)]">
          <Check size={16} aria-hidden="true" className="shrink-0 text-brand-mint" />
          {message}
        </div>
      )}
    </div>
  );
}
