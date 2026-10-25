import { lineIds, targetKey } from './ids.js';
import { validateLine } from './lines.js';

// Edit plan for a budget line (AD5): turns "set/remove this target from month M" into creates and updates
// applied as upsert by id. Never deletes. Pure.

const idOf = (line) => String(line.$id ?? line.id ?? '');
const previousMonth = (month) => {
  const [year, number] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
};
// Row data without Appwrite system fields ($id, $createdAt...) and a legacy `id` alias.
const dataOf = (line) => Object.fromEntries(Object.entries(line).filter(([name]) => name[0] !== '$' && name !== 'id'));

/**
 * request: `{ target: {targetType, targetId}, rule, value, month, span: 'month'|'onward', action: 'set'|'remove',
 * actorId, source, categoriesById }`. `value` is `amountMinor` (fixed) or `percentBp` (percent); remove ignores it.
 * Returns `{ ok: true, creates, updates }` or `{ ok: false, code, creates: [], updates: [] }`; rows are `{ id, data }`.
 */
export function planLineEdit(lines, request) {
  const { target, month, span, action, actorId, source, categoriesById } = request;
  const key = targetKey(target);
  const own = lines.filter((line) => targetKey(line) === key);
  const existingIds = new Set(lines.map(idOf));
  const oneMonth = own
    .filter((line) => line.fromMonth === month && line.toMonth === month)
    .reduce((best, line) => (!best || idOf(line) > idOf(best) ? line : best), null);
  const covering = own
    .filter((line) => line.toMonth == null && line.fromMonth <= month)
    .reduce((best, line) => (!best || line.fromMonth > best.fromMonth ? line : best), null);

  const value = action === 'remove' ? 0 : request.value;
  const rulePart = action !== 'remove' && request.rule === 'percent'
    ? { rule: 'percent', percentBp: value, amountMinor: null }
    : { rule: 'fixed', amountMinor: value, percentBp: null };
  const stamp = { actorId, source };
  const creates = [];
  const updates = [];
  const patch = (line, changes) => updates.push({ id: idOf(line), data: { ...dataOf(line), ...changes, ...stamp } });
  const fresh = (id, fromMonth, toMonth) => {
    const row = { id, data: { ...target, ...rulePart, fromMonth, toMonth, alertAtPercent: null, ...stamp } };
    (existingIds.has(id) ? updates : creates).push(row);
  };

  if (span === 'month') {
    if (oneMonth) patch(oneMonth, rulePart);
    else fresh(lineIds.override(target, month), month, month);
  } else if (action === 'set') {
    if (covering && covering.fromMonth === month) patch(covering, rulePart);
    else {
      if (covering) patch(covering, { toMonth: previousMonth(month) });
      fresh(lineIds.recurring(target, month), month, null);
    }
  } else {
    if (covering) patch(covering, covering.fromMonth === month ? rulePart : { toMonth: previousMonth(month) });
    if (oneMonth) patch(oneMonth, rulePart);
  }

  for (const row of [...creates, ...updates]) {
    const checked = validateLine(row.data, categoriesById);
    if (!checked.ok) return { ok: false, code: checked.code, creates: [], updates: [] };
  }
  return { ok: true, creates, updates };
}
