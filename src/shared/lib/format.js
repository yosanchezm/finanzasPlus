// Mirrors appwriteConfig.currency without importing the Appwrite SDK into presentational code.
export const DEFAULT_CURRENCY = String(import.meta.env.VITE_APPWRITE_CURRENCY || 'COP').toUpperCase();
const MINUS = '−';

export const formatMoney = (value, currency = DEFAULT_CURRENCY) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency, maximumFractionDigits: 0,
}).format(Number(value) || 0).replace(/\s?COP/g, '').replace(/\u00a0/g, ' ');

/** Like formatMoney, but negatives use a true minus sign before the symbol: "− $ 1.000". */
export const formatSignedMoney = (value, currency) => {
  const number = Number(value) || 0;
  return number < 0 ? `${MINUS} ${formatMoney(-number, currency)}` : formatMoney(number, currency);
};

/** Transaction amount with its direction: "+ $ X" for income, "− $ X" for expenses. */
export const formatTransactionAmount = ({ type, amountMinor, currency }) => (
  `${type === 'income' ? '+' : MINUS} ${formatMoney(amountMinor, currency)}`
);

export const formatShort = (value) => new Intl.NumberFormat('es-CO', {
  notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 1,
}).format(Number(value) || 0).replace(/\u00a0/g, ' ');

export const formatPercent = (value) => `${Math.round(Number(value) || 0)} %`;

const dayMonthFormat = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });

/** "28 oct". */
export const formatDate = (isoDate) => {
  if (!isoDate) return 'Sin fecha';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  const parts = dayMonthFormat.formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value.replace('.', '');
  return `${day} ${month}`;
};

/** "octubre de 2026" from a "2026-10" month key. */
export const formatMonth = (value) => new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
  .format(new Date(`${value}-01T12:00:00`));

/** "junio de 2027" from an ISO date. */
export const formatMonthOfDate = (isoDate) => new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
  .format(new Date(isoDate));

/** "Lunes, 12 de octubre". */
export const formatLongDate = (date = new Date()) => {
  const text = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** "Octubre 2026" from a "2026-10" month key. */
export const formatMonthLabel = (key) => {
  const text = formatMonth(key).replace(' de ', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** "Oct 2026" from a "2026-10" month key, for tight spaces. */
export const formatShortMonthLabel = (key) => {
  const text = new Intl.DateTimeFormat('es-CO', { month: 'short', year: 'numeric' })
    .format(new Date(`${key}-01T12:00:00`)).replace('.', '').replace(' de ', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** "Mayo" from a "2026-05" month key. */
export const formatMonthName = (key) => {
  const text = new Intl.DateTimeFormat('es-CO', { month: 'long' }).format(new Date(`${key}-01T12:00:00`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};
