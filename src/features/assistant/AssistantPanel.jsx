import { Bot, Send, Sparkles, X } from 'lucide-react';
import { formatSignedMoney } from '../../shared/lib/format';
import { DialogClose, DialogContent, DialogDescription, DialogRoot, DialogTitle } from '../../shared/ui/Dialog';
import { cn, focusRing } from '../../shared/ui/cn';

const SUGGESTIONS = [
  { label: 'Revisar movimientos', view: 'Movimientos' },
  { label: 'Ver presupuesto', view: 'Presupuesto' },
  { label: 'Revisar metas', view: 'Metas' },
];

/** Nia side sheet (bottom sheet on mobile). The web chat is not available yet, so the composer stays disabled. */
export default function AssistantPanel({ onClose, onNavigate, balanceMinor, transactionsCount }) {
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="side">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-sidebar text-brand-mint"><Bot size={20} /></span>
          <div className="flex min-w-0 flex-1 flex-col">
            <DialogTitle className="text-sm font-semibold text-ink">Nia</DialogTitle>
            <DialogDescription className="text-xs text-ink-faint">Tu copiloto financiero</DialogDescription>
          </div>
          <DialogClose aria-label="Cerrar" className={cn('grid size-9 place-items-center rounded-sm text-ink-muted hover:bg-surface-2 hover:text-ink', focusRing)}>
            <X size={18} aria-hidden="true" />
          </DialogClose>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6">
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-4">
            <span aria-hidden="true" className="mb-1 grid size-9 place-items-center rounded-sm bg-accent-soft text-accent"><Sparkles size={18} /></span>
            <h3 className="text-base font-semibold text-ink">Hola. Estoy conectada.</h3>
            <p className="text-sm leading-[22px] text-ink-muted">
              Tu dashboard ya está leyendo Appwrite. Para interpretar recibos y frases como “ayer”, usa el bot de Telegram configurado para este hogar.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5 rounded-sm border border-border p-3">
              <dt className="text-xs text-ink-faint">Balance del mes</dt>
              <dd className="text-sm font-semibold text-ink tabular-nums">{formatSignedMoney(balanceMinor)}</dd>
            </div>
            <div className="flex flex-col gap-1.5 rounded-sm border border-border p-3">
              <dt className="text-xs text-ink-faint">Movimientos sincronizados</dt>
              <dd className="text-sm font-semibold text-ink tabular-nums">{transactionsCount}</dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map(({ label, view }) => (
              <button
                key={view}
                type="button"
                onClick={() => onNavigate(view)}
                className={cn('h-9 rounded-full border border-[#c6e4d2] bg-accent-soft px-3 text-[13px] font-medium text-accent hover:bg-[#d4ebe0]', focusRing)}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="flex gap-2.5 rounded-sm bg-shared-soft p-3 text-[13px] leading-5 text-shared">
            <Bot size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            La conversación web de Nia se habilitará sobre la misma Function cuando definamos su endpoint autenticado. Telegram ya puede registrar gastos y recibos.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-5 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
          <input
            disabled
            aria-label="Mensaje para Nia"
            placeholder="Disponible próximamente en web"
            className="h-10 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface-2 px-3 text-base text-ink placeholder:text-ink-faint disabled:cursor-not-allowed sm:text-sm"
          />
          <button type="button" disabled aria-label="Enviar" className="grid size-10 shrink-0 place-items-center rounded-sm bg-accent/50 text-white disabled:cursor-not-allowed">
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
