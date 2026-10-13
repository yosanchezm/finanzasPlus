import { pesos } from './format.js';

// Reply templates of the debt flow. Pure and Node 16 safe.

export const TELEGRAM_LIMIT = 4096;
const MAX_LIST_ITEMS = 15;
const CUT_NOTE = '\n… (mensaje recortado)';

/** Telegram rejects messages over 4096 characters: cut at a line break when possible. */
export function clampTelegram(text, limit = TELEGRAM_LIMIT) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit - CUT_NOTE.length);
  const cut = head.lastIndexOf('\n');
  return `${cut > limit / 2 ? head.slice(0, cut) : head}${CUT_NOTE}`;
}

const percent = (value) => `${Number(value.toFixed(2))}% E.A.`;

function itemLine(item) {
  if (item.unreadable) return `• ${item.name} · no pude leer sus términos`;
  const parts = [`• ${item.name}`, `saldo ${pesos(item.balanceMinor)}`];
  if (item.nextDue) {
    parts.push(`próxima cuota ${pesos(item.nextDue.amountMinor)} el ${item.nextDue.dueOn}`);
    if (item.eaPercent !== null && item.eaPercent !== undefined) parts.push(percent(item.eaPercent));
  } else {
    parts.push('sin cuotas pendientes');
  }
  if (item.pastDueMinor > 0) parts.push(`vencido ${pesos(item.pastDueMinor)}`);
  return parts.join(' · ');
}

/**
 * The list action.
 * @param {{ name: string, balanceMinor?: number, pastDueMinor?: number, eaPercent?: number,
 *   nextDue?: ({ dueOn: string, amountMinor: number } | null), unreadable?: boolean }[]} items Code-computed summaries.
 */
export function listReply(items) {
  if (items.length === 0) {
    return '💳 No hay deudas registradas todavía. Puedes crear una escribiéndome, por ejemplo: “Pedí un préstamo de 10 millones al 24% E.A. a 36 cuotas”.';
  }
  const total = items.filter((item) => !item.unreadable).reduce((sum, item) => sum + item.balanceMinor, 0);
  const lines = [`💳 Tus deudas (${items.length})`, '', ...items.slice(0, MAX_LIST_ITEMS).map(itemLine)];
  if (items.length > MAX_LIST_ITEMS) lines.push(`… y ${items.length - MAX_LIST_ITEMS} más en la web`);
  lines.push('', `Saldo total: ${pesos(total)}`);
  return lines.join('\n');
}
