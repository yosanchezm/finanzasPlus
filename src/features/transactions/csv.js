import { dateInputValue } from '../../shared/lib/dates';
import { ownerLabel } from '../../shared/lib/owners';

// Byte order mark so Excel opens the UTF-8 file with accents intact.
const BOM = String.fromCharCode(0xfeff);
const LINE_BREAK = String.fromCharCode(13, 10);
// es-CO Excel uses the comma as decimal mark, so its list separator is the semicolon.
const SEPARATOR = ';';
const HEADER = ['Fecha', 'Concepto', 'Categoría', 'Tipo', 'Quién', 'Monto', 'Nota'];

/** RFC 4180 escaping: quote values containing separators, quotes or line breaks; double inner quotes. */
export const escapeCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[";,\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toCsvRow = (item, currentOwnerScope) => {
  const date = new Date(item.occurredAt);
  const amount = Number(item.amountMinor || 0);
  return [
    Number.isNaN(date.getTime()) ? '' : dateInputValue(date),
    item.merchant,
    item.categoryName,
    item.type === 'income' ? 'Ingreso' : 'Gasto',
    ownerLabel(item.ownerScope, currentOwnerScope),
    item.type === 'income' ? amount : -amount,
    item.note,
  ].map(escapeCsvValue).join(SEPARATOR);
};

/** CSV of the given transactions: BOM, Spanish header, semicolon separator, CRLF line endings, signed plain amounts. */
export const buildTransactionsCsv = (rows, currentOwnerScope) => (
  BOM + [HEADER.join(SEPARATOR), ...rows.map((item) => toCsvRow(item, currentOwnerScope))].join(LINE_BREAK)
);
