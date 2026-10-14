import { STRATEGIES } from './extract.js';
import { MODES } from './planChange.js';

// The pending payload that rides in `bot_sessions.pendingJson` and the inline
// keyboards of the debt flow (NDA-4). Pure and Node 16 safe.

export const PENDING_MAX_BYTES = 1500;
export const CALLBACK_MAX_BYTES = 64;
export const MAX_PICK_BUTTONS = 6;
/** `de{id}` must fit the core's 34 character event id limit, `db{id}` the 36 of Appwrite. */
export const PENDING_ID_MAX = 24;

export const CONVENTION_BUTTONS = ['EA', 'NAMV', 'MV', 'NATV', 'NATA'];
const CONVENTION_LABELS = { EA: 'E.A.', NAMV: 'N.A.M.V.', MV: 'M.V.', NATV: 'N.A.T.V.', NATA: 'N.A.T.A.' };
const MODE_LABELS = { keep_term: 'Mantener el plazo', keep_installment: 'Mantener la cuota' };
const STRATEGY_LABELS = { reduce_term: 'Reducir plazo', reduce_installment: 'Reducir cuota', advance_installments: 'Adelantar cuotas' };

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Builds the pending payload and asserts it stays compact.
 * @param {{ id: string, action: 'create'|'pay'|'simulate'|'advise'|'legal_rate'|'rate_change'|'charge_change'|'restructure'|'late_policy', awaiting: 'confirm'|'pick'|'strategy'|'convention'|'simpay'|'mode'|'charge',
 *   debtId?: string, candidates?: string[], draft: object, preview?: object }} fields
 */
export function buildPending(fields) {
  if (typeof fields.id !== 'string' || fields.id === '' || fields.id.length > PENDING_ID_MAX) {
    throw fail('invalid_pending', `the pending id must have 1-${PENDING_ID_MAX} characters`);
  }
  const pending = { kind: 'debt', v: 1, ...fields };
  const size = Buffer.byteLength(JSON.stringify(pending), 'utf8');
  if (size > PENDING_MAX_BYTES) throw fail('pending_too_large', `the pending payload takes ${size} bytes; the limit is ${PENDING_MAX_BYTES}`);
  return pending;
}

/** Idempotency key shared by the event, so a double Confirm or a Telegram retry writes once. */
export const dedupeKeyOf = (pending) => `debt:${pending.id}`;
export const eventIdOf = (pending) => `de${pending.id}`;
export const debtRowId = (pending) => `db${pending.id}`;

function button(text, data) {
  if (Buffer.byteLength(data, 'utf8') > CALLBACK_MAX_BYTES) throw fail('callback_too_long', `callback_data over ${CALLBACK_MAX_BYTES} bytes: ${data}`);
  return { text, callback_data: data };
}

/** One row per debt, at most 6. */
export function pickKeyboard(debts) {
  return debts.slice(0, MAX_PICK_BUTTONS).map((debt) => [button(String(debt.name).slice(0, 40), `nia:pick:${debt.$id}`)]);
}

/** Same buttons and callbacks as the other Nia confirmations. */
export function confirmKeyboard() {
  return [[button('Confirmar', 'nia:confirm'), button('Editar', 'nia:edit'), button('Cancelar', 'nia:cancel')]];
}

export function strategyKeyboard() {
  return STRATEGIES.map((strategy) => [button(STRATEGY_LABELS[strategy], `nia:strat:${strategy}`)]);
}

/** The single button under a simulation: it becomes a payment preview with the simulated strategy. */
export function simulateKeyboard() {
  return [[button('Registrar este abono', 'nia:simpay')]];
}

export function conventionKeyboard() {
  const buttons = CONVENTION_BUTTONS.map((name) => button(CONVENTION_LABELS[name], `nia:conv:${name}`));
  return [buttons.slice(0, 3), buttons.slice(3)];
}

/**
 * The mode buttons of a rate change: keep the term (the installment is recalculated) or keep the installment (the term is).
 * @param {string[]} [modes] The modes the debt offers (`modesFor`); `keep_installment` only exists for French loans.
 */
export function modeKeyboard(modes = MODES) {
  return modes.filter((mode) => MODES.includes(mode)).map((mode) => [button(MODE_LABELS[mode], `nia:mode:${mode}`)]);
}

/**
 * One button per candidate charge, by position: charge ids can be long and a callback holds 64 bytes. At most 6, as for debts.
 * @param {{ label: string }[]} charges In the same order as the `candidates` stored in the pending.
 */
export function chargeKeyboard(charges) {
  return charges.slice(0, MAX_PICK_BUTTONS).map((charge, index) => [button(String(charge.label).slice(0, 40), `nia:chg:${index}`)]);
}

/** @returns {{ type: 'pick'|'strategy'|'convention'|'simpay'|'mode'|'charge', value: (string|number|null) } | null} */
export function parseCallback(data) {
  if (data === 'nia:simpay') return { type: 'simpay', value: null };
  const match = typeof data === 'string' ? data.match(/^nia:(pick|strat|conv|mode|chg):(.+)$/) : null;
  if (!match) return null;
  const [, kind, value] = match;
  if (kind === 'pick') return { type: 'pick', value };
  if (kind === 'strat') return STRATEGIES.includes(value) ? { type: 'strategy', value } : null;
  if (kind === 'mode') return MODES.includes(value) ? { type: 'mode', value } : null;
  if (kind === 'chg') return /^\d$/.test(value) ? { type: 'charge', value: Number(value) } : null;
  return CONVENTION_BUTTONS.includes(value) ? { type: 'convention', value } : null;
}
