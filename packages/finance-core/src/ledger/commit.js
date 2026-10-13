import { compareIso } from '../calendar.js';
import { CommitError, ValidationError } from '../errors.js';
import { activeEvents, validateEvent } from './events.js';
import { project } from './project.js';

// Write path (AD6, AD7). `planCommit` is pure: it turns a draft into the event
// row and, when the payment has a cost, the expense row. `commitPlan` writes
// them through a port with exactly-once semantics: the event is unique by its
// `dedupeKey`, the cost row has the deterministic id `dc{eventId}`, and a 409
// means "already done".

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,33}$/; // "dc" + id must fit Appwrite's 36 characters
const SOURCES = ['web', 'telegram'];
const PAYLOAD_MAX_CHARS = 8000;
const COST_NOTE = 'Intereses y cargos';
// The candidate is the newest event of its day, whatever the stored ones say.
const NEWEST = '9999-12-31T23:59:59.999Z';

const invalid = (message) => new ValidationError('invalid_commit', message);
const hasStatus = (error, status) => error?.code === status || error?.status === status;

function checkContext(debt, ctx) {
  if (typeof (debt.$id ?? debt.id) !== 'string' || typeof debt.householdId !== 'string' || debt.householdId === '') {
    throw invalid('the debt needs an id and a householdId');
  }
  if (typeof ctx?.eventId !== 'string' || !EVENT_ID.test(ctx.eventId)) throw invalid('ctx.eventId must be 1-34 characters: letters, digits, dot, hyphen or underscore');
  if (typeof ctx.actorId !== 'string' || ctx.actorId === '') throw invalid('ctx.actorId is required');
  if (!SOURCES.includes(ctx.source)) throw invalid(`ctx.source must be one of ${SOURCES.join(', ')}`);
}

/**
 * The expense row that carries only the cost of one payment event (never its principal).
 * `categoryId` stays null: the writer fills it once the category exists.
 * @param {object} debt A `debts` row.
 * @param {{ id: string, effectiveOn: string, actorId: string }} event A normalized event.
 * @param {number} costMinor
 * @returns {{ id: string, data: object }}
 */
export function buildCostRow(debt, event, costMinor) {
  const { id, effectiveOn } = event;
  return {
    id: `dc${id}`,
    data: {
      householdId: debt.householdId,
      actorId: event.actorId,
      ownerScope: debt.ownerScope,
      type: 'expense',
      amountMinor: costMinor,
      currency: 'COP',
      occurredAt: `${effectiveOn}T12:00:00.000Z`,
      merchant: debt.name,
      categoryId: null, // filled by commitPlan once the category exists
      note: COST_NOTE,
      source: 'debt',
      confidence: 1,
      status: 'confirmed',
      providerRef: `debt:${id}`,
      dedupeKey: `debt:${id}`,
      debtId: debt.$id ?? debt.id,
    },
  };
}

/**
 * Plans the writes for a new event without touching anything.
 * @param {object} debt A `debts` row (`$id`, `householdId`, `name`, `ownerScope`, terms).
 * @param {object[]} events The stored events of the debt.
 * @param {object} draft `{ kind, effectiveOn, amountMinor?, ...payload }`, for example
 *   `{ kind: 'payment', effectiveOn, amountMinor, bankSplit? }` or `{ kind: 'void', effectiveOn, targetEventId, reason }`.
 * @param {{ eventId: string, dedupeKey?: string, actorId: string, source: 'web'|'telegram', asOf?: string }} ctx
 *   `eventId` and `dedupeKey` come from the caller (one per dialog or pending request, so a retry repeats them);
 *   a void derives its own `dedupeKey` (`void:{targetEventId}`).
 * @returns {{ event: { id: string, data: object }, costRow: ({ id: string, data: object } | null), costMinor: number,
 *   allocation: (object | null), deleteCostRowId: (string | null), projection: object }}
 *   `projection` is the state right after the new event, for previews.
 * @throws {ValidationError}
 */
export function planCommit(debt, events, draft, ctx) {
  checkContext(debt, ctx);
  const { kind, effectiveOn, amountMinor = 0, ...payload } = draft;
  const debtId = debt.$id ?? debt.id;
  const candidate = validateEvent({ id: ctx.eventId, debtId, kind, effectiveOn, amountMinor, payload, createdAt: NEWEST, actorId: ctx.actorId, source: ctx.source });
  let dedupeKey = ctx.dedupeKey;
  let deleteCostRowId = null;
  if (kind === 'void') {
    const { targetEventId } = candidate.payload;
    if (!activeEvents(events).some((event) => event.id === targetEventId)) {
      throw new ValidationError('invalid_void_target', `event ${targetEventId} does not exist or is already voided`);
    }
    dedupeKey = `void:${targetEventId}`;
    deleteCostRowId = `dc${targetEventId}`;
  }
  if (typeof dedupeKey !== 'string' || dedupeKey === '') throw invalid('ctx.dedupeKey is required');
  const payloadJson = JSON.stringify(candidate.payload);
  if (payloadJson.length > PAYLOAD_MAX_CHARS) {
    throw new ValidationError('payload_too_large', `the payload takes ${payloadJson.length} characters; the limit is ${PAYLOAD_MAX_CHARS}`);
  }
  const asOf = ctx.asOf && compareIso(ctx.asOf, effectiveOn) > 0 ? ctx.asOf : effectiveOn;
  const projection = project(debt, [...events, { ...candidate, dedupeKey }], asOf);
  const entry = projection.applied.find((applied) => applied.eventId === candidate.id);
  const allocation = entry?.allocation ?? null;
  const costMinor = entry?.costMinor ?? 0;
  return {
    event: {
      id: candidate.id,
      data: { householdId: debt.householdId, debtId, kind, effectiveOn, amountMinor, payloadJson, actorId: ctx.actorId, source: ctx.source, dedupeKey },
    },
    costRow: costMinor > 0 ? buildCostRow(debt, candidate, costMinor) : null,
    costMinor,
    allocation,
    deleteCostRowId,
    projection,
  };
}

const idOf = (row) => row.$id ?? row.id;

async function storeEvent(port, event) {
  try {
    return { stored: await port.createEvent(event), duplicate: false };
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    const stored = await port.findEventByDedupe(event.data.dedupeKey);
    if (!stored) throw error;
    return { stored, duplicate: true };
  }
}

// The row id and references follow the event that really exists, which can
// differ from the planned one when another client won the dedupe race.
function rowForEvent(costRow, plannedEventId, storedEventId, categoryId) {
  const data = { ...costRow.data, categoryId };
  if (storedEventId === plannedEventId) return { id: costRow.id, data };
  return { id: `dc${storedEventId}`, data: { ...data, providerRef: `debt:${storedEventId}`, dedupeKey: `debt:${storedEventId}` } };
}

async function storeCostRow(port, row) {
  try {
    return await port.createCostRow(row);
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    return { $id: row.id, ...row.data };
  }
}

/**
 * Runs a plan against a port. Safe to repeat: the same plan twice leaves one
 * event and one cost row. If a step after the event fails, a {@link CommitError}
 * (`partial: true`) is thrown; show it as a failed save and run the plan again.
 * @param {{ ensureCostCategory: (householdId: string) => Promise<string>, createEvent: (event: object) => Promise<object>,
 *   findEventByDedupe: (dedupeKey: string) => Promise<(object | null)>, createCostRow: (row: object) => Promise<object>,
 *   deleteCostRow: (id: string) => Promise<void>, atomic?: Function }} port
 *   Errors carry the HTTP status as `code` (or `status`); 409 means "exists", 404 "missing".
 * @param {ReturnType<typeof planCommit>} plan
 * @returns {Promise<{ event: object, costRow: (object | null), duplicate: boolean }>}
 */
export async function commitPlan(port, plan) {
  const { event, costRow, deleteCostRowId } = plan;
  const categoryId = costRow ? await port.ensureCostCategory(costRow.data.householdId) : null;
  const { stored, duplicate } = await storeEvent(port, event);
  const eventId = idOf(stored);
  try {
    const written = costRow ? await storeCostRow(port, rowForEvent(costRow, event.id, eventId, categoryId)) : null;
    if (deleteCostRowId) {
      try {
        await port.deleteCostRow(deleteCostRowId);
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
      }
    }
    return { event: stored, costRow: written, duplicate };
  } catch (cause) {
    throw new CommitError('cost_row_failed', `event ${eventId} was saved but its cost row was not; run the same plan again`, { eventId, cause });
  }
}
