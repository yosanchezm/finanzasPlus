import { Info, TriangleAlert } from 'lucide-react';
import { formatMonthOfDate } from '../../../shared/lib/format';
import { formatDecimal } from '../debtLabels';

// Spanish copy for the core's legal notices, keyed by `code`. They are informational only.
const COPY = {
  usury_above_cap: (notice) => (
    `Esta tasa equivale a ${formatDecimal(notice.eaPercent)} % E.A. y supera el tope de usura de ${formatDecimal(notice.capEA)} % E.A. `
    + `de ${formatMonthOfDate(`${notice.asOf}T12:00:00`)}${notice.verified ? '' : ' (dato sin verificar oficialmente)'}. Es solo un aviso: puedes guardar igual.`
  ),
  ley1555_scope_unverified: () => (
    'La Ley 1555 podría permitirte abonar a una hipoteca sin penalidad y elegir cómo se aplica el abono. '
    + 'No verificamos si aplica a esta deuda: revisa tu contrato.'
  ),
};

export default function Notices({ notices }) {
  return notices.filter((notice) => COPY[notice.code]).map((notice) => {
    const Icon = notice.severity === 'warning' ? TriangleAlert : Info;
    return (
      <p key={notice.code} role="note" className="flex items-start gap-2 rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] leading-5 text-shared">
        <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>{COPY[notice.code](notice)}</span>
      </p>
    );
  });
}
