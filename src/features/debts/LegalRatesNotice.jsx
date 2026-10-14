export const LEGAL_RATES_UNAVAILABLE = 'No pudimos leer las tasas legales del hogar; usamos los valores de la app.';

/**
 * Load-time notice `legal_rates_unavailable` (informational, never blocking): the household legal tables
 * could not be read, so every figure uses the code tables. Renders nothing when they were read (`ok`).
 */
export default function LegalRatesNotice({ legalStatus }) {
  if (legalStatus !== 'missing' && legalStatus !== 'unavailable') return null;
  return <p role="status" className="rounded-sm bg-shared-soft px-3 py-2.5 text-[13px] text-shared">{LEGAL_RATES_UNAVAILABLE}</p>;
}
