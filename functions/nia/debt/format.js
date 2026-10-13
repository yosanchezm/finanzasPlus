// Small text helpers shared by the debt replies. Node 16 safe.

const PESOS = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/** `$ 1.234.567` */
export const pesos = (value) => PESOS.format(value);

/** `YYYY-MM-DD` of `now` in the household time zone. */
export function isoDateIn(now, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
