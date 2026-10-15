import { formatMonthLabel } from '../../shared/lib/format';
import { cn, focusRing } from '../../shared/ui/cn';
import WhatIsThis from './explain/WhatIsThis';

// Informational notices of the mora engine (`projection.notices`). They explain a figure; none of them blocks an action.
const LATE_NOTICES = {
  late_cap_stale: (notice) => `La tabla de topes de usura no llega a hoy, así que la mora usa el último tope vigente (hasta ${formatMonthLabel(notice.lastValidTo.slice(0, 7))}).`,
  late_cap_unknown: () => 'No hay un tope de usura registrado para esta modalidad; la mora usa la tasa del contrato.',
  late_mortgage_unverified: () => 'En créditos hipotecarios la mora no aplica las reglas de la Ley 546 de 1999. Confirma el valor con tu banco.',
};
const WITH_SETTINGS_LINK = ['late_cap_stale', 'late_cap_unknown'];

/**
 * The legal notices of the mora (stale or unknown usury cap, mortgage rules not applied), one line each, informational.
 * The cap notices link to Ajustes, where the caps are entered, when `onOpenSettings` is given. The first notice carries the
 * «¿Qué es esto?» of the mora when `explain` (the popover of the mora) is given. Renders nothing without notices.
 */
export default function LateNotices({ notices, onOpenSettings, explain }) {
  const shown = notices.filter((notice) => notice.code in LATE_NOTICES);
  return shown.map((notice, index) => (
    <p key={notice.code} role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared">
      {LATE_NOTICES[notice.code](notice)}
      {onOpenSettings && WITH_SETTINGS_LINK.includes(notice.code) && (
        <> <button type="button" onClick={onOpenSettings} className={cn('rounded-sm font-semibold underline underline-offset-2', focusRing)}>Actualizar los topes en Ajustes</button></>
      )}
      {index === 0 && <WhatIsThis popover={explain} subject="Aviso de mora" className="ml-1 align-middle" />}
    </p>
  ));
}
