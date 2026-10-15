import { compareIso, isIsoDate } from '../calendar.js';
import { ValidationError } from '../errors.js';
import { checkCorrection } from './correction.js';
import { validateEvent } from './events.js';
import { project } from './project.js';
import { assertRestructurable } from './restructure.js';
import { snapshot } from './snapshot.js';

// Plan change preview (DL2, AD8): replay project() with and without a synthetic
// candidate event, as `simulateExtra` does for prepayments. Nothing is written
// and no input is touched.

const PREVIEW_KINDS = ['rate_change', 'charge_change', 'restructure', 'late_policy', 'terms_correction'];
// The candidate is the newest event of its day, like the one planCommit will write.
const CANDIDATE = Object.freeze({ id: 'preview:change', createdAt: '9999-12-31T23:59:59.999Z' });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Active events whose cost changes with the candidate (a payment's interest, charges and taxes).
function impactedBy(baseline, changed) {
  const before = new Map(baseline.applied.map((entry) => [entry.eventId, entry]));
  const impacted = [];
  for (const entry of changed.applied) {
    const earlier = before.get(entry.eventId);
    if (!earlier || entry.eventId === CANDIDATE.id || earlier.costMinor === entry.costMinor) continue;
    impacted.push({ eventId: entry.eventId, kind: entry.kind, effectiveOn: entry.effectiveOn, costBeforeMinor: earlier.costMinor, costAfterMinor: entry.costMinor });
  }
  return impacted;
}

// The recorded statements (adjustments) of a card and how many of them no longer match once the correction re-cuts the cycles.
function statementsOf(baseline, changed) {
  const before = new Map(baseline.applied.filter((entry) => entry.kind === 'adjustment').map((entry) => [entry.eventId, entry.driftMinor ?? 0]));
  const drifted = changed.applied.filter((entry) => entry.kind === 'adjustment' && before.has(entry.eventId) && before.get(entry.eventId) !== (entry.driftMinor ?? 0));
  return { recorded: before.size, drifted: drifted.length };
}

/**
 * Previews a plan change before it is saved: the debt as of a date with and without the change,
 * and the past events whose cost the change would alter. The numbers are measured at the later of
 * `on` and the effective date, the same date `planCommit` projects at, so the preview equals the
 * projection once the event is saved. Pure and read-only.
 * @param {object} debt A `debts` row (see `project`).
 * @param {object[]} events The debt's `debt_events` rows.
 * @param {{ kind: 'rate_change' | 'charge_change' | 'restructure' | 'late_policy' | 'terms_correction', effectiveOn: string }} draft The same shape
 *   `planCommit` takes: `{ kind, effectiveOn, ...payload }`; build a `terms_correction` draft with `buildCorrection`.
 * @param {{ on: string }} options `on` is the reference date (usually today), `YYYY-MM-DD`.
 * @returns {{ before: object, after: object, backdated: boolean, payloadChars: number, notices: object[],
 *   impacted: Array<{ eventId: string, kind: string, effectiveOn: string, costBeforeMinor: number, costAfterMinor: number }> }}
 *   `before` and `after` are snapshots (see `snapshot`); `backdated` is true when the change takes effect before `on`;
 *   `payloadChars` is the length of the serialized payload (the event column holds 8000); `notices` are those of the projection with the change.
 *   A `terms_correction` adds `corrected: { before, after }` (the values of the corrected fields, read from the terms version they belong to)
 *   and `statements: { recorded, drifted }` (the card statements recorded as adjustments, and those whose drift the correction changes).
 * @throws {ValidationError} `invalid_draft` for another kind, `invalid_date`, `invalid_event` for a bad payload,
 *   `restructure_unsupported` for a restructure of a card, `correction_not_applicable`, `correction_target_missing` and the correction
 *   field errors for a `terms_correction`, and
 *   `installment_too_low` when `keep_installment` cannot cover the new interest or the plan would pass 2000 periods.
 */
export function previewChange(debt, events, draft, { on } = {}) {
  if (!isIsoDate(on)) throw new ValidationError('invalid_date', `on must be a real YYYY-MM-DD date, got ${String(on)}`);
  if (!isObject(draft) || !PREVIEW_KINDS.includes(draft.kind)) {
    throw new ValidationError('invalid_draft', `a plan change preview needs a draft of kind ${PREVIEW_KINDS.join(', ')}, got ${String(draft?.kind)}`);
  }
  const { kind, effectiveOn, amountMinor = 0, ...payload } = draft;
  if (kind === 'restructure') assertRestructurable(debt);
  const candidate = validateEvent({ id: CANDIDATE.id, kind, effectiveOn, amountMinor, payload, createdAt: CANDIDATE.createdAt });
  const asOf = compareIso(on, candidate.effectiveOn) > 0 ? on : candidate.effectiveOn;
  const corrected = kind === 'terms_correction' ? checkCorrection(debt, events, candidate) : null;
  const baseline = project(debt, events, asOf);
  const changed = project(debt, [...events, candidate], asOf);
  const preview = {
    before: snapshot(baseline, asOf),
    after: snapshot(changed, asOf),
    backdated: compareIso(candidate.effectiveOn, on) < 0,
    payloadChars: JSON.stringify(candidate.payload).length,
    impacted: impactedBy(baseline, changed),
    notices: changed.notices ?? [],
  };
  return corrected === null ? preview : { ...preview, corrected, statements: statementsOf(baseline, changed) };
}
