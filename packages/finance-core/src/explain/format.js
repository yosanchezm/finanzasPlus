// Spanish (Colombia) formatting of the figures an explanation prints: "$ 1.375", "28,32 %", "31 de octubre de 2026".
// The facts builders pre-format every printable figure with these, so the guard can check a rendered text number by
// number. Pure and Node 16 safe (no Intl: the output must not depend on the runtime's locale data).

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Whole pesos with `.` for thousands: 1375 gives "$ 1.375". */
export function pesosText(minor) {
  const digits = String(Math.abs(Math.round(minor))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${minor < 0 ? '-' : ''}$ ${digits}`;
}

/** A percentage with a decimal comma and up to two decimals: 28.3243 gives "28,32 %", 2.1 gives "2,1 %". */
export function percentText(value) {
  return `${String(Number(value.toFixed(2))).replace('.', ',')} %`;
}

/** The month of an ISO date: "octubre de 2026". */
export function monthText(iso) {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
}

/** An ISO date as text: "31 de octubre de 2026". */
export function dateText(iso) {
  return `${Number(iso.slice(8, 10))} de ${monthText(iso)}`;
}

/** Rounds to four decimals, so the raw figure in `numbers` is stable and short. */
export const round4 = (value) => Math.round(value * 10000) / 10000;
