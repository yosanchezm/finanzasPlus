import { useId } from 'react';
import { formatMoney } from '../../shared/lib/format';

/**
 * Warning of a plan change dated in the past: the recorded payments whose financial cost would change
 * (`impacted`: `{ eventId, label, costBeforeMinor, costAfterMinor }`, see `impactedFor`), or that none does.
 * `title` and `intro` let another change that reaches back (a data correction) say it in its own words.
 */
export default function BackdatedNotice({ impacted, title = 'Cambio con fecha pasada', intro = 'Esta fecha ya pasó: el costo de pagos ya registrados puede cambiar.' }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-sm bg-danger-soft px-3 py-2.5 text-[13px] leading-5 text-[#9a3412]">
      <h3 id={titleId} className="font-semibold">{title}</h3>
      <p>{intro}</p>
      {impacted.length === 0 ? <p>Ningún pago registrado cambia de costo.</p> : (
        <ul className="flex flex-col gap-1">
          {impacted.map((entry) => (
            <li key={entry.eventId} className="flex flex-col">
              <b className="font-semibold">{entry.label}</b>
              <span className="tabular-nums">Costo financiero {formatMoney(entry.costBeforeMinor)} → {formatMoney(entry.costAfterMinor)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
