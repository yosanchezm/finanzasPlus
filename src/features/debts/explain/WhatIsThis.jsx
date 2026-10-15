import * as Popover from '@radix-ui/react-popover';
import { CircleQuestionMark } from 'lucide-react';
import { cn, focusRing } from '../../../shared/ui/cn';

/**
 * «¿Qué es esto?» next to a figure of the debt views: a small icon button that opens a read-only popover with the
 * explanation of its topic. `popover` is `popoverOf(...)` (the core facts, the reviewed copy, the source line and the exact
 * disclaimer); without one the component renders nothing, so a topic that is not released shows no trigger. `subject` is the
 * figure it sits next to and completes the accessible name. Radix handles Enter, Space, Escape, the focus return and the
 * collision with the screen edge; a tap opens it on a phone. It writes nothing.
 */
export default function WhatIsThis({ popover, subject, className }) {
  if (!popover) return null;
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`¿Qué es esto? ${subject}`}
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink aria-expanded:bg-accent-soft aria-expanded:text-accent',
          focusRing,
          className,
        )}
      >
        <CircleQuestionMark size={16} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={popover.title}
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 flex max-h-[70vh] w-[min(360px,calc(100vw-32px))] flex-col gap-3 overflow-y-auto rounded-md border border-border bg-surface p-4 text-sm font-normal text-ink shadow-[0_12px_32px_rgba(15,26,21,.16)] outline-none"
        >
          <p className="text-base font-semibold">{popover.title}</p>
          {popover.lines.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-sm bg-surface-2 px-3 py-2 tabular-nums">
              {popover.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {popover.paragraphs.map((paragraph) => <p key={paragraph} className="text-ink-2">{paragraph}</p>)}
          <footer className="flex flex-col gap-1 border-t border-border pt-3 text-[13px] text-ink-muted">
            <p>{popover.source}</p>
            <p>{popover.disclaimer}</p>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
