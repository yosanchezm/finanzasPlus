import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Paperclip, Pencil, Receipt, RefreshCw, Trash2 } from 'lucide-react';
import { formatDateTime, formatPercent, formatTransactionAmount } from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Chip, OwnerChip } from '../../shared/ui/Chip';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { DialogContent, DialogRoot, DialogTitle } from '../../shared/ui/Dialog';
import { cn, focusRing } from '../../shared/ui/cn';

// Values written to transactions.source: 'web' by this app, 'telegram' by the Nia function.
const SOURCE_LABELS = { web: 'Web', telegram: 'Telegram · Nia' };

const sourceLabel = ({ source, confidence }) => {
  const label = SOURCE_LABELS[source] || source;
  return source !== 'web' && typeof confidence === 'number' ? `${label} (confianza ${formatPercent(confidence * 100)})` : label;
};

/** actorId is an Appwrite user id, or "telegram:<id>" when Nia could not link the Telegram user. */
const authorLabel = (actorId, members, currentUserId) => {
  if (String(actorId).startsWith('telegram:')) return 'Usuario de Telegram sin vincular';
  const member = members.find((item) => item.userId === actorId);
  if (actorId === currentUserId) return `${member?.alias || 'Tú'} (tú)`;
  return member?.alias || 'Integrante del hogar';
};

const linkClass = cn('inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-accent underline-offset-2 hover:text-accent-hover hover:underline', focusRing);

function ImageReceipt({ attachment }) {
  // 0: thumbnail, 1: original file, 2: both failed (private bucket, blocked third-party cookies…).
  const [stage, setStage] = useState(0);
  const name = attachment.originalName || 'recibo';
  if (stage === 2) {
    return (
      <div className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-2 p-3">
        <span className="text-[13px] text-ink-muted">No se pudo mostrar la vista previa en la app.</span>
        <a href={attachment.viewUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <ExternalLink size={14} aria-hidden="true" />{`Abrir recibo ${name}`}
        </a>
      </div>
    );
  }
  return (
    <a href={attachment.viewUrl} target="_blank" rel="noopener noreferrer" className={cn('block overflow-hidden rounded-sm border border-border', focusRing)}>
      <img
        src={stage === 0 ? attachment.previewUrl : attachment.viewUrl}
        alt={`Recibo ${name}`}
        onError={() => setStage((current) => current + 1)}
        className="max-h-72 w-full bg-surface-2 object-contain"
      />
    </a>
  );
}

function FileReceipt({ attachment }) {
  const name = attachment.originalName || 'recibo';
  const isPdf = attachment.mimeType === 'application/pdf';
  return (
    <a href={attachment.viewUrl} target="_blank" rel="noopener noreferrer" className={cn(linkClass, 'rounded-sm border border-border px-3 py-2.5 no-underline hover:no-underline')}>
      <FileText size={16} aria-hidden="true" />
      {`Abrir recibo ${name}${isPdf ? ' (PDF)' : ''}`}
    </a>
  );
}

function Receipts({ transactionId, loadAttachments }) {
  const [state, setState] = useState({ status: 'loading', attachments: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', attachments: [] });
    loadAttachments(transactionId)
      .then((attachments) => { if (active) setState({ status: 'ready', attachments }); })
      .catch(() => { if (active) setState({ status: 'error', attachments: [] }); });
    return () => { active = false; };
  }, [transactionId, loadAttachments, attempt]);

  return (
    <section aria-labelledby="receipt-heading" className="flex flex-col gap-2">
      <h3 id="receipt-heading" className="flex items-center gap-2 text-sm font-semibold text-ink"><Paperclip size={16} aria-hidden="true" />Recibo</h3>
      {state.status === 'loading' && <p role="status" className="text-sm text-ink-muted">Cargando recibos…</p>}
      {state.status === 'error' && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>No se pudieron cargar los recibos.</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className={linkClass}>
            <RefreshCw size={14} aria-hidden="true" />Reintentar
          </button>
        </div>
      )}
      {state.status === 'ready' && !state.attachments.length && <p className="text-sm text-ink-muted">Sin recibo</p>}
      {state.status === 'ready' && state.attachments.map((attachment) => (
        String(attachment.mimeType).startsWith('image/')
          ? <ImageReceipt key={attachment.$id} attachment={attachment} />
          : <FileReceipt key={attachment.$id} attachment={attachment} />
      ))}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[#eef1ed] py-3 last:border-b-0 sm:grid sm:grid-cols-[140px_1fr] sm:gap-3">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words text-ink">{children}</dd>
    </div>
  );
}

/**
 * Read-only view of one transaction: right sheet on desktop, bottom sheet on mobile.
 * Shows only metadata the transactions table really stores (source, confidence, actorId, $createdAt/$updatedAt).
 */
export default function TransactionDetail({ transaction, currentOwnerScope, currentUserId, members = [], loadAttachments, onClose, onEdit, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isIncome = transaction.type === 'income';
  const CategoryIcon = transaction.icon || Receipt;
  const edited = transaction.$updatedAt && transaction.$createdAt && transaction.$updatedAt !== transaction.$createdAt;

  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent variant="side" aria-describedby={undefined} className="sm:w-[420px]">
        <div className="flex flex-col gap-2 border-b border-border px-6 pt-6 pb-5">
          <DialogTitle className="text-base font-semibold break-words text-ink">{transaction.merchant}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[32px] leading-10 font-semibold tracking-[-0.8px] tabular-nums', isIncome ? 'text-accent' : 'text-ink')}>
              {formatTransactionAmount(transaction)}
            </span>
            <Chip tone={isIncome ? 'you' : 'neutral'}>{isIncome ? 'Ingreso' : 'Gasto'}</Chip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-4">
          <dl>
            <Field label="Concepto">{transaction.merchant}</Field>
            <Field label="Categoría">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: transaction.categoryColor || '#A7B0AB' }} />
                <CategoryIcon size={16} aria-hidden="true" className="shrink-0 text-ink-muted" />
                {transaction.categoryName || 'Sin categoría'}
              </span>
            </Field>
            <Field label="Quién"><OwnerChip ownerScope={transaction.ownerScope} currentOwnerScope={currentOwnerScope} /></Field>
            <Field label="Fecha"><span className="tabular-nums">{formatDateTime(transaction.occurredAt)}</span></Field>
            <Field label="Nota">{transaction.note ? transaction.note : <span className="text-ink-muted">Sin nota</span>}</Field>
            {transaction.source && <Field label="Registrado vía">{sourceLabel(transaction)}</Field>}
            {transaction.actorId && <Field label="Creado por">{authorLabel(transaction.actorId, members, currentUserId)}</Field>}
            {transaction.$createdAt && <Field label="Fecha de registro"><span className="tabular-nums">{formatDateTime(transaction.$createdAt)}</span></Field>}
            {edited && <Field label="Última edición"><span className="tabular-nums">{formatDateTime(transaction.$updatedAt)}</span></Field>}
          </dl>

          <Receipts transactionId={transaction.$id} loadAttachments={loadAttachments} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] sm:pb-4">
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} className="text-danger hover:bg-danger-soft hover:text-danger">
            <Trash2 size={16} aria-hidden="true" />Eliminar
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            <Button onClick={() => onEdit(transaction)}><Pencil size={16} aria-hidden="true" />Editar</Button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="¿Eliminar movimiento?"
          description={`“${transaction.merchant}” se eliminará de Appwrite. Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { setConfirmDelete(false); onDelete(transaction); }}
        />
      </DialogContent>
    </DialogRoot>
  );
}
