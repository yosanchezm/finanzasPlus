import { MENTIONS } from '../extract.js';

// What the user may say about a debt that Nia cannot save yet (design G13, ADV8): the card limit, the advance rate, the prepayment penalty,
// the order in which payments are applied and the base of the mora. Each is explained in one line and answered «no soportado aún»; nothing is
// written and nothing pretends it was. Pure and Node 16 safe.

export const NOT_YET = 'no soportado aún';

const TEXTS = {
  card_limit: `El cupo de la tarjeta: ${NOT_YET}. No lo guardo ni finjo que quedó guardado.`,
  advance_rate: `La tasa de los avances en efectivo: ${NOT_YET}. No la guardo.`,
  prepayment_penalty: `La penalización por abonos anticipados: ${NOT_YET}. No la guardo.`,
  allocation_order: `El orden en que se aplican los pagos: ${NOT_YET}. Sigo usando el orden que ya maneja la app.`,
  mora_base: `Cobrar la mora sobre toda la cuota: ${NOT_YET}. La mora se sigue calculando sobre el capital vencido.`,
};

/**
 * One line per unsupported field, in the order of the catalogue (`MENTIONS`); codes that are not in it are ignored.
 * @param {string[]} [codes]
 * @returns {string} Empty when there is nothing unsupported.
 */
export function unsupportedText(codes) {
  const asked = Array.isArray(codes) ? codes : [];
  return MENTIONS.filter((code) => asked.includes(code)).map((code) => TEXTS[code]).join('\n');
}
