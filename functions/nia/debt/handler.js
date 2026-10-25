import { EXPLAIN_TOPICS, ValidationError, advise, commitPlan, compareStrategies, explainFacts, legalRateId, normalizeRate, planCommit, previewChange, project, rateInForce, resolveLegal, serializeTerms, toEffectiveAnnual } from '../../../packages/finance-core/index.js';
import { buildSetupTerms } from './advisor/cardTerms.js';
import { compactCase, expandCase, isOtherDebt, mergeCase } from './advisor/merge.js';
import { STEP_RECORDED, advanceChain, chainReport, checklistText, planChain } from './advisor/chain.js';
import { proposeSetup } from './advisor/propose.js';
import { unsupportedText } from './advisor/unsupported.js';
import { cashflowSignals, cashflowWindow, inScopeFor } from './cashflow.js';
import { describeCorrection, previewCorrection, rebuildCorrection } from './correction.js';
import { applicableDebts, cardOnly, explainReplyParaphrased, menuReply, pickReply, recoveryReply } from './explain/flow.js';
import { debtPrompt, normaliseDebtExtraction } from './extract.js';
import { MAX_CANDIDATES, findDebt, fold } from './findDebt.js';
import { isoDateIn, pesos } from './format.js';
import { guardParaphrase } from './guard.js';
import { describeLatePolicy, previewLatePolicy } from './late.js';
import { describeLegalRate, isStorableLegalRate, previewLegalRate } from './legal.js';
import { adjustKeyboard, buildPending, chargeKeyboard, confirmKeyboard, conventionKeyboard, debtRowId, dedupeKeyOf, eventIdOf, minimumKeyboard, modeKeyboard, otherDebtKeyboard, parseCallback, parseExplainCallback, pickKeyboard, simulateKeyboard, strategyKeyboard, withChain } from './pending.js';
import { CHARGE_GONE_TEXT, TOO_LOW_CONFIRM, chargesInForce, describeChargeAdd, describeChargeChange, describeRateChange, describeRestructure, previewChargeChange, previewRateChange, previewRestructure, rebuildCharges, rebuildRestructure, restructureDraft } from './planChange.js';
import { conventionQuestion, describeCoreError, previewCreate, previewPay, buildTerms, setupText, withConvention } from './preview.js';
import { adviseReply, clampTelegram, listReply, paraphrasePrompt, simulateReply } from './replies.js';

// Debt flow of Nia (NDA-1, NDA-3, NDA-4). The model only extracts; every number comes
// from the shared core and every write needs a confirmation. All I/O goes through
// the injected `deps`, so the flow runs in tests without network:
//   deps = { listRows(table, where), createRow(table, { id, data }), updateRow(table, id, data), deleteRow(table, id),
//            gemini(prompt), sendMessage(chatId, text, keyboard), saveSession(chatId, actorId, status, pending, history),
//            now(), ids: { pending() }, cashflowRows({ from, to }),
//            config: { householdId, timezone, currency, webUrl?, adviceThresholds?, paraphraseTimeoutMs? } }
// `createRow` rejects with `status: 409` when the id or a unique key already exists; a `legal_rate` Confirm then calls `updateRow`.

const T = { debts: 'debts', events: 'debt_events', transactions: 'transactions', categories: 'categories', legal: 'legal_rates' };
const COST_CATEGORY = { name: 'Costos financieros', kind: 'debt', color: '#7A5AF8', icon: 'receipt' };
const STATUS = { confirm: 'awaiting_confirmation', pick: 'awaiting_clarification', strategy: 'awaiting_clarification', convention: 'awaiting_clarification', simpay: 'awaiting_clarification', mode: 'awaiting_clarification', charge: 'awaiting_clarification', minimum: 'awaiting_clarification', answers: 'awaiting_clarification', adjust_kind: 'awaiting_clarification', other: 'awaiting_clarification' };
const PARAPHRASE_TIMEOUT_MS = 8000;
const LEGAL_SOURCE = 'Nia (Telegram)';

const CARDS_WEB = 'Simular y recomendar abonos aplica a préstamos con plan de cuotas; todavía no está disponible para tarjetas (ni en la web).';
const TOO_MANY_STEPS = 'Son demasiados cambios para hacerlos de una vez. Pídeme primero los más importantes y luego seguimos con el resto; no guardé nada.';
const TOO_MANY_CHARGES = 'Esa deuda tiene demasiados cargos para registrarla por Telegram. Créala desde la web, en la sección Deudas.';
const ASK_EXTRA = '¿Cuánto quieres abonar? Escríbeme el monto en pesos.';
const PROBLEMS = {
  negative_amount: 'El monto no puede ser negativo. Escríbelo de nuevo, por ejemplo: “pagué 500.000 al carro”.',
  invalid_amount: 'No entendí el monto. Escríbelo en pesos y sin decimales.',
  future_date: 'La fecha del pago no puede ser futura. ¿Qué día fue?',
  invalid_rate: 'La tasa no es válida: debe ser desde 0 y, si es anticipada, menor a 100 % por periodo. ¿Cuál es?',
  invalid_day: 'El día debe ser un número del 1 al 31. Escríbelo de nuevo; no guardé nada.',
  legal_value_out_of_range: 'Ese valor no parece una tasa válida: debe estar entre 5 % y 100 % E.A. y tener máximo dos decimales (por ejemplo, 28.2). Escríbelo de nuevo; no guardé nada.',
  legal_smmlv_out_of_range: 'El salario mínimo debe estar entre $ 100.000 y $ 100.000.000, en pesos enteros. Escríbelo de nuevo; no guardé nada.',
  legal_mortgage_needs_usury: 'Para la hipoteca registra directamente la tasa de usura: el IBC no la deriva. Dime la usura y el mes; no guardé nada.',
  legal_unknown_modality: 'No reconozco esa modalidad. Puede ser consumo y ordinario, bajo monto, productivo (rural o urbano), popular (rural o urbano) o hipotecario.',
  late_invalid_multiple: 'El múltiplo de la tasa del contrato debe ser mayor que 0 y de hasta 3 veces. Escríbelo de nuevo; no guardé nada.',
  late_invalid_grace: 'Los días de gracia deben ser un número entero de 0 a 90. Escríbelos de nuevo; no guardé nada.',
  late_invalid: 'Esa política de mora no es válida: revisa la tasa que me diste. Escríbela de nuevo; no guardé nada.',
  legal_invalid_month: 'No entendí el mes o el año. Escríbelo, por ejemplo, “noviembre” o “noviembre de 2026”.',
};
const MISSING = {
  amount: 'el monto del pago',
  name: 'el nombre de la deuda',
  principal: 'el monto del préstamo',
  rate: 'la tasa de interés',
  term: 'el número de cuotas',
  legal_kind: 'si es la tasa de usura, el IBC o el salario mínimo',
  legal_value: 'el valor',
  legal_month: 'el mes',
  charge: 'el seguro o cargo',
  charge_spec: 'qué seguro o cargo quieres agregar',
  correction_field: 'qué dato quieres corregir (el día de corte, el día de pago, el pago mínimo, la tasa o la modalidad)',
  charge_action: 'si quieres cambiar su valor o quitarlo',
  charge_value: 'el nuevo valor',
  late_mode: 'si quieres mora a la tasa de usura, a una tasa fija, como múltiplo de la tasa del contrato, o sin mora',
  late_rate: 'la tasa de la mora',
  late_multiple: 'cuántas veces la tasa del contrato',
};

const hasStatus = (error, status) => Boolean(error) && (error.status === status || error.code === status);
const clip = (value) => String(value || '').trim().slice(0, 700);

// `explain` is the `{topic, debtId}` marker of an explanation (design G4). It rides in the last assistant entry of the history, so
// the pending is untouched and the next reply of any kind expires the marker.
function turn(history, user, reply, explain) {
  const items = [...(history || [])];
  if (clip(user)) items.push({ role: 'user', content: clip(user) });
  if (clip(reply)) items.push({ role: 'assistant', content: clip(reply), ...(explain ? { explain } : {}) });
  return items.slice(-10);
}

/**
 * The `{topic, debtId}` marker of the last explanation, read from the LAST history entry only (any later reply expires it).
 * It also carries the `stated` rate and the `amountMinor` the user gave, when valid, so «Ver más» re-renders the same explanation.
 * @param {object[]} history
 * @returns {({ topic: string, debtId: (string | null), stated?: object, amountMinor?: number } | null)}
 */
export function lastExplain(history) {
  const last = Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null;
  const marker = last && last.role === 'assistant' ? last.explain : null;
  if (!marker || typeof marker !== 'object' || !EXPLAIN_TOPICS.includes(marker.topic)) return null;
  if (marker.debtId !== null && marker.debtId !== undefined && typeof marker.debtId !== 'string') return null;
  const stated = marker.stated && typeof marker.stated === 'object' && Number.isFinite(marker.stated.value) ? { stated: marker.stated } : {};
  const amount = Number.isSafeInteger(marker.amountMinor) && marker.amountMinor > 0 ? { amountMinor: marker.amountMinor } : {};
  return { topic: marker.topic, debtId: marker.debtId ?? null, ...stated, ...amount };
}

// Saves the session (and the turn) and then answers. In a chain (`ctx.chain`, S6b) the chain rides in the pending and the Confirm button carries its id.
async function say(deps, ctx, { text, keyboard, status, pending, explain }) {
  const chained = ctx.chain && pending && !pending.done ? withChain(pending, ctx.chain) : pending;
  const buttons = chained && chained.chain && chained.awaiting === 'confirm' ? confirmKeyboard(chained.id) : keyboard;
  await deps.saveSession(ctx.chatId, ctx.actorId, status, chained, turn(ctx.history, ctx.text, text, explain));
  await deps.sendMessage(ctx.chatId, clampTelegram(text), buttons);
}

// Answers without touching the session: the pending request, if any, stays as it was. Inside a chain an answer that is a problem stops the chain and says so.
const inform = (deps, ctx, text) => (ctx.chain
  ? say(deps, ctx, { text: chainReport(ctx.chain, { issue: text }), status: 'completed', pending: null })
  : say(deps, ctx, { text, status: ctx.sessionStatus || 'conversation', pending: ctx.previous || null }));
const notify = (deps, ctx, text) => deps.sendMessage(ctx.chatId, clampTelegram(text));

/**
 * The household's resolved legal tables (IBC, usury caps, SMMLV) over the code tables. Never throws: when legal_rates
 * cannot be read (a 404 before the migration, or any other failure) it returns the code tables with status 'unavailable'.
 */
export async function loadLegal(deps) {
  try {
    return resolveLegal(await deps.listRows(T.legal, { householdId: deps.config.householdId }));
  } catch {
    return resolveLegal.unavailable();
  }
}

/** Every debt row of the household, each decorated with the same resolved `legal` tables the web uses (pass `legal` to reuse a read). */
export async function loadDebts(deps, legal) {
  const tables = legal || (await loadLegal(deps));
  const rows = await deps.listRows(T.debts, { householdId: deps.config.householdId });
  return rows.map((debt) => ({ ...debt, legal: tables }));
}

const loadEvents = (deps, debtId) => deps.listRows(T.events, { householdId: deps.config.householdId, debtId });
const today = (deps) => isoDateIn(deps.now(), deps.config.timezone);

async function ensureCostCategory(deps, householdId) {
  const find = async () => (await deps.listRows(T.categories, { householdId })).find((category) => fold(category.name) === fold(COST_CATEGORY.name)) || null;
  const existing = await find();
  if (existing) return existing.$id;
  try {
    const created = await deps.createRow(T.categories, { id: `cf${householdId}`.slice(0, 36), data: { householdId, ...COST_CATEGORY, archived: false } });
    return created.$id;
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    const raced = await find();
    if (!raced) throw error;
    return raced.$id;
  }
}

// The port `commitPlan` writes through (same shape as the web's `debtPort()`).
const debtPort = (deps) => ({
  ensureCostCategory: (householdId) => ensureCostCategory(deps, householdId),
  createEvent: (event) => deps.createRow(T.events, event),
  findEventByDedupe: async (dedupeKey) => (await deps.listRows(T.events, { householdId: deps.config.householdId, dedupeKey }))[0] || null,
  createCostRow: (row) => deps.createRow(T.transactions, row),
  deleteCostRow: (id) => deps.deleteRow(T.transactions, id),
});

async function summaries(deps, debts, asOf) {
  const events = await deps.listRows(T.events, { householdId: deps.config.householdId });
  return debts.filter((debt) => debt.status !== 'archived').map((debt) => {
    try {
      const projection = project(debt, events.filter((event) => event.debtId === debt.$id), asOf);
      const { nextDue } = projection;
      return {
        id: debt.$id,
        name: debt.name,
        ownerScope: debt.ownerScope,
        balanceMinor: projection.balanceMinor,
        pastDueMinor: projection.pastDueMinor,
        lateInterestMinor: projection.lateInterestMinor ?? 0,
        nextDue: nextDue ? { dueOn: nextDue.dueOn, amountMinor: nextDue.outstandingMinor } : null,
        eaPercent: toEffectiveAnnual(rateInForce(projection)),
      };
    } catch {
      return { id: debt.$id, name: debt.name, ownerScope: debt.ownerScope, unreadable: true };
    }
  });
}

/** Code-computed summaries of every non-archived debt: what the list, the advice and the analysis snapshot show. */
export async function debtSummaries(deps) {
  return summaries(deps, await loadDebts(deps), today(deps));
}

async function finishCreate(deps, ctx, id, create, legal) {
  const preview = previewCreate(create, { legal: legal || (await loadLegal(deps)) });
  if (preview.needsConvention) {
    const pending = buildPending({ id, action: 'create', awaiting: 'convention', draft: { create } });
    return say(deps, ctx, { text: preview.text, keyboard: conventionKeyboard(), status: STATUS.convention, pending });
  }
  if (!preview.ok) return inform(deps, ctx, `No pude armar la deuda: ${preview.issue}`);
  let pending;
  try {
    pending = buildPending({ id, action: 'create', awaiting: 'confirm', draft: { create } });
  } catch (error) {
    if (error.code !== 'pending_too_large') throw error;
    return inform(deps, ctx, TOO_MANY_CHARGES);
  }
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

// A legal rate (NI1): the draft is the whole pending (a few dozen bytes), nothing is written until Confirm.
async function startLegalRate(deps, ctx, request) {
  if (request.missingFields.length) return inform(deps, ctx, `Para registrar la tasa legal necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const pending = buildPending({ id: deps.ids.pending(), action: 'legal_rate', awaiting: 'confirm', draft: request.legalRate });
  return say(deps, ctx, { text: previewLegalRate(request.legalRate), keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

async function continuePay(deps, ctx, id, debt, draft) {
  const events = await loadEvents(deps, debt.$id);
  const request = { amountMinor: draft.amountMinor, paidOn: draft.effectiveOn, strategy: draft.strategy || null };
  const eventCtx = { eventId: eventIdOf({ id }), dedupeKey: dedupeKeyOf({ id }), actorId: ctx.profile.appwriteUserId, source: 'telegram' };
  const preview = previewPay({ debt, events, request, today: today(deps), ctx: eventCtx });
  if (!preview.ok) return inform(deps, ctx, preview.issue);
  if (!preview.plan) {
    const pending = buildPending({ id, action: 'pay', awaiting: 'strategy', debtId: debt.$id, draft });
    const text = `El abono de ${pesos(draft.amountMinor)} supera lo que toca pagar ahora. Elige cómo aplicar el excedente:`;
    return say(deps, ctx, { text, keyboard: strategyKeyboard(), status: STATUS.strategy, pending });
  }
  const { kind } = preview.plan.event.data;
  const final = { kind, effectiveOn: draft.effectiveOn, amountMinor: draft.amountMinor, ...(kind === 'extra_payment' ? { strategy: draft.strategy } : {}) };
  const pending = buildPending({ id, action: 'pay', awaiting: 'confirm', debtId: debt.$id, draft: final, preview: preview.summary });
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

// Finds the debt a request is about: a match runs at once, otherwise the user picks with buttons.
async function withDebt(deps, ctx, { debtRef }, debts, { action, draft, question }, run) {
  const found = findDebt(debts, debtRef);
  if (found.match) return run(deps.ids.pending(), found.match);
  const options = found.candidates || debts.filter((debt) => debt.status === 'active').slice(0, MAX_CANDIDATES);
  if (options.length === 0) return inform(deps, ctx, 'No tienes deudas registradas todavía. Puedes crear una escribiéndome los datos del préstamo.');
  const pending = buildPending({ id: deps.ids.pending(), action, awaiting: 'pick', candidates: options.map((debt) => debt.$id), draft });
  return say(deps, ctx, { text: question, keyboard: pickKeyboard(options), status: STATUS.pick, pending });
}

// A rate change (NI2): the debt first, then the convention and the mode when they are missing, then the core preview.
// The pending keeps only what the user chose (date, rate, mode); Confirm rebuilds everything from the live debt.
async function continueRate(deps, ctx, id, debt, draft) {
  if (!draft.rate) {
    const pending = buildPending({ id, action: 'rate_change', awaiting: 'convention', debtId: debt.$id, draft });
    return say(deps, ctx, { text: conventionQuestion(draft.rateValue), keyboard: conventionKeyboard(), status: STATUS.convention, pending });
  }
  const preview = previewRateChange({ debt, events: await loadEvents(deps, debt.$id), today: today(deps), draft });
  if (!preview.ok) return inform(deps, ctx, preview.issue);
  if (preview.needsMode) {
    const pending = buildPending({ id, action: 'rate_change', awaiting: 'mode', debtId: debt.$id, draft });
    return say(deps, ctx, { text: preview.text, keyboard: modeKeyboard(preview.modes), status: STATUS.mode, pending });
  }
  const pending = buildPending({ id, action: 'rate_change', awaiting: 'confirm', debtId: debt.$id, draft: preview.draft });
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

async function startRateChange(deps, ctx, request, debts) {
  if (request.missingFields.length) return inform(deps, ctx, `Para cambiar la tasa necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const { effectiveOn, mode, rate, rateValue } = request.planChange;
  const draft = { effectiveOn, ...(mode ? { mode } : {}), ...(rate ? { rate } : { rateValue }) };
  return withDebt(deps, ctx, request, debts, { action: 'rate_change', draft, question: '¿A cuál deuda le cambio la tasa?' }, (id, debt) => continueRate(deps, ctx, id, debt, draft));
}

// A charge change (NI2, NI6): Nia adds a preset or an explicit charge, edits the value of a charge the debt already has, or removes it. The pending
// stores the charge id, the operation and the value (or the add block); the whole charge set is rebuilt from the live debt at Confirm.
async function continueCharge(deps, ctx, id, debt, draft) {
  const preview = previewChargeChange({ debt, events: await loadEvents(deps, debt.$id), today: today(deps), draft });
  if (!preview.ok) return inform(deps, ctx, preview.issue);
  if (preview.needsCharge) {
    const pending = buildPending({ id, action: 'charge_change', awaiting: 'charge', debtId: debt.$id, candidates: preview.candidates.map((charge) => charge.id), draft });
    return say(deps, ctx, { text: preview.text, keyboard: chargeKeyboard(preview.candidates), status: STATUS.charge, pending });
  }
  const pending = buildPending({ id, action: 'charge_change', awaiting: 'confirm', debtId: debt.$id, draft: preview.draft });
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

async function startChargeChange(deps, ctx, request, debts) {
  const { effectiveOn, chargeRef, op, newValue } = request.planChange;
  if (request.missingFields.length) return inform(deps, ctx, `Para ${op === 'add' ? 'agregar' : 'cambiar'} un seguro o cargo necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const draft = op === 'add' ? { effectiveOn, op, add: request.planChange.add } : { effectiveOn, chargeRef, op, newValue };
  return withDebt(deps, ctx, request, debts, { action: 'charge_change', draft, question: '¿A cuál deuda le cambio el seguro o cargo?' }, (id, debt) => continueCharge(deps, ctx, id, debt, draft));
}

// A terms correction (NA6): data that was wrong from the start. The pending keeps only what the user stated (card fields, modality, rate); the event is
// rebuilt from the live debt for the preview and again at Confirm. What Nia cannot save yet (the card limit...) is answered first and never written.
async function continueCorrection(deps, ctx, id, debt, draft) {
  if (draft.rateValue !== undefined && !draft.rate) {
    const pending = buildPending({ id, action: 'terms_correction', awaiting: 'convention', debtId: debt.$id, draft });
    return say(deps, ctx, { text: conventionQuestion(draft.rateValue), keyboard: conventionKeyboard(), status: STATUS.convention, pending });
  }
  const preview = previewCorrection({ debt, events: await loadEvents(deps, debt.$id), today: today(deps), draft });
  if (!preview.ok) return inform(deps, ctx, preview.issue);
  const pending = buildPending({ id, action: 'terms_correction', awaiting: 'confirm', debtId: debt.$id, draft: preview.draft });
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

async function startTermsCorrection(deps, ctx, request, debts) {
  if (request.missingFields.length) return inform(deps, ctx, `Para corregir los datos necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const { fields, rateValue, mentions } = request.correction;
  const unsupported = unsupportedText(mentions);
  if (Object.keys(fields).length === 0 && rateValue === null) return inform(deps, ctx, unsupported);
  if (unsupported) await notify(deps, ctx, unsupported);
  const draft = { ...fields, ...(rateValue === null ? {} : { rateValue }) };
  return withDebt(deps, ctx, request, debts, { action: 'terms_correction', draft, question: '¿A cuál deuda le corrijo los datos?' }, (id, debt) => continueCorrection(deps, ctx, id, debt, draft));
}

// A restructure (NI3): the pending keeps only the overrides the user stated (date, number of installments, rate, system, periodicity, first due
// date, charges, waiveLate). The arrears, the carried balance and the new terms are rebuilt from the live debt, for the preview and again at Confirm.
async function continueRestructure(deps, ctx, id, debt, draft) {
  if (!draft.rate && draft.rateValue !== undefined) {
    const pending = buildPending({ id, action: 'restructure', awaiting: 'convention', debtId: debt.$id, draft });
    return say(deps, ctx, { text: conventionQuestion(draft.rateValue), keyboard: conventionKeyboard(), status: STATUS.convention, pending });
  }
  const preview = previewRestructure({ debt, events: await loadEvents(deps, debt.$id), today: today(deps), draft });
  if (!preview.ok) return inform(deps, ctx, preview.issue);
  const pending = buildPending({ id, action: 'restructure', awaiting: 'confirm', debtId: debt.$id, draft: preview.draft });
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

async function startRestructure(deps, ctx, request, debts) {
  if (request.missingFields.length) return inform(deps, ctx, `Para reestructurar necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const draft = restructureDraft(request.planChange);
  return withDebt(deps, ctx, request, debts, { action: 'restructure', draft, question: '¿Cuál deuda quieres reestructurar?' }, (id, debt) => continueRestructure(deps, ctx, id, debt, draft));
}

// A mora policy (NI4): the debt first, then the convention of a fixed rate when it is missing, then the core preview. The pending keeps the
// policy the user chose (mode, rate or multiple, grace days, date); Confirm rebuilds the figures from the live debt. A card takes it too (its core projector bills the mora at the next statement).
async function continueLate(deps, ctx, id, debt, draft) {
  if (draft.rateValue !== undefined) {
    const pending = buildPending({ id, action: 'late_policy', awaiting: 'convention', debtId: debt.$id, draft });
    return say(deps, ctx, { text: conventionQuestion(draft.rateValue), keyboard: conventionKeyboard(), status: STATUS.convention, pending });
  }
  const preview = previewLatePolicy({ debt, events: await loadEvents(deps, debt.$id), today: today(deps), draft });
  if (!preview.ok) return inform(deps, ctx, preview.issue);
  const pending = buildPending({ id, action: 'late_policy', awaiting: 'confirm', debtId: debt.$id, draft: preview.draft });
  return say(deps, ctx, { text: preview.text, keyboard: confirmKeyboard(), status: STATUS.confirm, pending });
}

async function startLatePolicy(deps, ctx, request, debts) {
  if (request.missingFields.length) return inform(deps, ctx, `Para configurar la mora necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const draft = request.latePolicy;
  return withDebt(deps, ctx, request, debts, { action: 'late_policy', draft, question: '¿A cuál deuda le configuro la mora?' }, (id, debt) => continueLate(deps, ctx, id, debt, draft));
}

async function startPay(deps, ctx, request, debts) {
  if (request.amountMinor === null) return inform(deps, ctx, '¿Cuánto pagaste? Escríbeme el monto en pesos.');
  const draft = { amountMinor: request.amountMinor, effectiveOn: request.paidOn, ...(request.strategy ? { strategy: request.strategy } : {}) };
  return withDebt(deps, ctx, request, debts, { action: 'pay', draft, question: '¿A cuál deuda corresponde el pago?' }, (id, debt) => continuePay(deps, ctx, id, debt, draft));
}

async function startAnalysis(deps, ctx, request, debts) {
  if (request.extraMinor === null) return inform(deps, ctx, ASK_EXTRA);
  const draft = { amountMinor: request.extraMinor, ...(request.strategy ? { strategy: request.strategy } : {}) };
  const question = request.action === 'simulate' ? '¿A cuál deuda quieres simular el abono?' : '¿Sobre cuál deuda quieres la recomendación?';
  return withDebt(deps, ctx, request, debts, { action: request.action, draft, question }, (id, debt) => runAnalysis(deps, ctx, request.action, id, debt, draft, debts));
}

// Simulate (NDA-5): the core compares the strategies and nothing is written. The session keeps what the
// nia:simpay button needs to turn the simulation into a payment.
async function simulate(deps, ctx, id, debt, draft, events) {
  const asOf = today(deps);
  const strategy = draft.strategy || 'reduce_term';
  const comparison = compareStrategies(debt, events, { amountMinor: draft.amountMinor, on: asOf });
  const eventCtx = { eventId: eventIdOf({ id }), dedupeKey: dedupeKeyOf({ id }), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf };
  const { projection } = planCommit(debt, events, { kind: 'extra_payment', effectiveOn: asOf, amountMinor: draft.amountMinor, strategy }, eventCtx);
  const text = simulateReply({ name: debt.name, comparison, strategy, plan: projection.plan, webUrl: deps.config.webUrl });
  const pending = buildPending({ id, action: 'simulate', awaiting: 'simpay', debtId: debt.$id, draft: { amountMinor: draft.amountMinor, strategy } });
  return say(deps, ctx, { text, keyboard: simulateKeyboard(), status: STATUS.simpay, pending });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('paraphrase timeout')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Gemini only rewords the facts (AD11). A failure, a timeout or a number that is not in the facts all mean null.
async function paraphrase(deps, facts, name, extras) {
  try {
    const raw = await withTimeout(deps.gemini(paraphrasePrompt(facts, name, extras)), deps.config.paraphraseTimeoutMs || PARAPHRASE_TIMEOUT_MS);
    // The mora figure comes from the core's snapshot, so its digits are allowed next to the facts' own.
    return guardParaphrase(raw && raw.reply, facts, [name, extras.lateInterestMinor > 0 ? pesos(extras.lateInterestMinor) : '']);
  } catch {
    return null;
  }
}

async function cashflowRows(deps, asOf) {
  try {
    return await deps.cashflowRows(cashflowWindow(asOf));
  } catch {
    return []; // unknown cash flow: the advice says so instead of guessing
  }
}

// Advise (NDA-5, NDA-6, DPA-2, DPA-3): compareStrategies + cash flow -> advise -> facts -> paraphrase -> guard -> template.
async function adviseOn(deps, ctx, debt, draft, events, debts) {
  const asOf = today(deps);
  const inScope = inScopeFor(debt.ownerScope);
  const comparison = compareStrategies(debt, events, { amountMinor: draft.amountMinor, on: asOf });
  const otherDebts = (await summaries(deps, debts, asOf))
    .filter((item) => !item.unreadable && item.id !== debt.$id && item.balanceMinor > 0 && inScope(item))
    .map(({ id, name, eaPercent }) => ({ id, name, eaPercent }));
  const signals = cashflowSignals({ rows: await cashflowRows(deps, asOf), today: asOf, timezone: deps.config.timezone, inScope, otherDebts });
  const { facts } = advise(comparison, signals, deps.config.adviceThresholds || {});
  const extras = { lateInterestMinor: comparison.reduceTerm.before.lateInterestMinor || 0 };
  return inform(deps, ctx, (await paraphrase(deps, facts, debt.name, extras)) || adviseReply(facts, debt.name, extras));
}

async function runAnalysis(deps, ctx, action, id, debt, draft, debts) {
  if (debt.kind === 'card') return inform(deps, ctx, CARDS_WEB);
  const events = await loadEvents(deps, debt.$id);
  try {
    return await (action === 'simulate' ? simulate(deps, ctx, id, debt, draft, events) : adviseOn(deps, ctx, debt, draft, events, debts));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return inform(deps, ctx, describeCoreError(error));
  }
}

// Explain (S0, design G2 to G6). It only reads: no row, event or pending is written, and the pending that was waiting is saved back as it was
// (`inform` semantics), so a Confirm that was waiting still works. The session save only adds the `{topic, debtId}` marker to the history.
const NO_EXPLAIN = { topic: null, stated: null, rateValue: null, amountMinor: null };

async function sendExplain(deps, ctx, { topic, debt, asked, legal, page = 1 }) {
  let facts;
  try {
    const events = debt ? await loadEvents(deps, debt.$id) : [];
    facts = explainFacts(topic, debt, events, legal, today(deps), { stated: asked.stated || undefined, amountMinor: asked.amountMinor ?? undefined, copy: deps.explainCopy });
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return inform(deps, ctx, describeCoreError(error));
  }
  const { text, keyboard } = await explainReplyParaphrased(deps, facts, { debtId: debt ? debt.$id : null, page });
  // The marker keeps what the user stated, so «Ver más» (which carries only the topic, the debt and the page) continues the same explanation.
  const stated = asked.stated ? { stated: asked.stated } : {};
  const amount = asked.amountMinor ? { amountMinor: asked.amountMinor } : {};
  return say(deps, ctx, { text, keyboard, status: ctx.sessionStatus || 'conversation', pending: ctx.previous || null, explain: { topic, debtId: debt ? debt.$id : null, ...stated, ...amount } });
}

// The topic: a follow-up that rides on the marker keeps the marker topic; otherwise the model's topic when it is valid, then the router's keyword hint.
async function startExplain(deps, ctx, request, debts, legal) {
  const asked = request.explain || NO_EXPLAIN;
  const hint = ctx.explainHint || null;
  const topic = hint && hint.fromMarker ? hint.topic : asked.topic || (hint && hint.topic) || null;
  const visible = debts.filter(inScopeFor(ctx.profile.ownerScope));
  const found = findDebt(visible, request.debtRef);
  if (!topic) return say(deps, ctx, { ...menuReply(found.match ? found.match.$id : null), status: ctx.sessionStatus || 'conversation', pending: ctx.previous || null });
  let match = found.match || null;
  if (found.candidates) {
    // A card topic among a loan and several cards: the loan is not a candidate, and a single card is the answer.
    const fit = applicableDebts(topic, found.candidates);
    if (fit.length !== 1) return say(deps, ctx, { ...pickReply(topic, found.candidates), status: ctx.sessionStatus || 'conversation', pending: ctx.previous || null });
    match = fit[0];
  } else if (found.none && !request.debtRef && !(hint && hint.fromMarker) && cardOnly(topic)) {
    // Several debts and none named: a card topic goes to the only card, picks among several, and says so when there is none.
    const active = visible.filter((item) => item.status === 'active');
    const cards = applicableDebts(topic, active);
    if (cards.length === 1 && active.length > 1) match = cards[0];
    else if (cards.length !== 1 && active.length > 0) return say(deps, ctx, { ...pickReply(topic, cards), status: ctx.sessionStatus || 'conversation', pending: ctx.previous || null });
  }
  const marker = lastExplain(ctx.history);
  const fromMarker = !match && !request.debtRef && hint && hint.fromMarker && marker && marker.topic === topic && marker.debtId;
  const debt = match || (fromMarker ? visible.find((item) => item.$id === marker.debtId) : null) || null;
  return sendExplain(deps, ctx, { topic, debt, asked, legal });
}

/**
 * `nia:exp:<topic>[:<debtId>][:<n>]` buttons: stateless and read-only, routed before the stage check, so they work with no pending. An
 * unknown topic, a deleted debt or a debt outside the member's scope gets a short safe reply and writes nothing (not even the session).
 * @param {object} deps
 * @param {{ chatId: string, actorId: string, profile: object, history: object[], previous: (object | null), sessionStatus?: string }} ctx `previous` is the session's pending payload, kept as it is.
 * @param {string} data The callback data.
 */
export async function handleExplainCallback(deps, ctx, data) {
  const parsed = parseExplainCallback(data);
  if (!parsed) return notify(deps, ctx, recoveryReply('unknown_topic'));
  const legal = await loadLegal(deps);
  const visible = (await loadDebts(deps, legal)).filter(inScopeFor(ctx.profile.ownerScope));
  const marker = lastExplain(ctx.history);
  // A button without an id (the topic menu, or the «Ver más» form that dropped it) resolves the debt from the marker, then like a text question.
  const wanted = parsed.debtId || (marker && marker.topic === parsed.topic ? marker.debtId : null);
  let debt = null;
  if (wanted) {
    debt = visible.find((item) => item.$id === wanted) || null;
    if (!debt) return notify(deps, ctx, recoveryReply('debt_gone'));
  } else {
    debt = findDebt(visible, null).match || null;
  }
  // A «Ver más» page re-renders what the marker says the user stated, but only for the same topic and the same debt.
  const sameAsMarker = parsed.page > 1 && marker && marker.topic === parsed.topic && marker.debtId === (debt ? debt.$id : null);
  const asked = sameAsMarker ? { ...NO_EXPLAIN, stated: marker.stated || null, amountMinor: marker.amountMinor || null } : NO_EXPLAIN;
  return sendExplain(deps, ctx, { topic: parsed.topic, debt, asked, legal, page: parsed.page });
}

// A described debt (S5c, design G13). The pending keeps the merged case; the stage says what the next message or button answers:
// `convention` (the rate type, buttons), `minimum` (the rule of the minimum payment, buttons), `answers` (text only) or `confirm`.
// Nothing is written here. A follow-up of an open setup keeps the pending id, so the debt row id and the event key stay the same.
const SETUP_TRACKED = ['statementDay', 'dueDay', 'minRule'];
const SETUP_KEYBOARDS = { confirm: confirmKeyboard, convention: conventionKeyboard, minimum: minimumKeyboard };

/** The pending of a described debt that still waits for the user (not the done marker). */
export const isOpenSetup = (pending) => Boolean(pending) && pending.kind === 'debt' && pending.action === 'setup' && !pending.done && Boolean(pending.draft && pending.draft.setup);

const SHORT_ANSWER_MAX = 160;

/**
 * Whether a message looks like the answer to the questions of an open setup (S5c): short, with a figure («el corte es el 15») or a «no sé».
 * It is the entry point's backstop for a classifier that calls such an answer a conversation; a longer text keeps the classifier's intent.
 */
export const answersOpenSetup = (pending, text) => isOpenSetup(pending) && typeof text === 'string' && text.length <= SHORT_ANSWER_MAX && (/\d/.test(text) || /\bno\s+(lo\s+)?(s[eé]|tengo|recuerdo)(?![a-zñáéíóú])/i.test(text));

function setupStage(proposal) {
  if (proposal.draft) return 'confirm';
  if (proposal.questions.some((question) => question.field === 'convention')) return 'convention';
  return proposal.questions.some((question) => question.field === 'minRule' && question.options) ? 'minimum' : 'answers';
}

// A described case about a debt that already exists (S6b, design G13 and G14): the advisor compares it with the stored debt and lists the differences
// as steps. A question (the rate convention, fix or change, a preset amount) waits for its answer; otherwise the steps run as a chain.
const ADJUST_STAGE = { convention: 'convention', fix_or_change: 'adjust_kind' };
const ADJUST_KEYBOARDS = { convention: conventionKeyboard, adjust_kind: adjustKeyboard };
const STEP_RUNNERS = { terms_correction: continueCorrection, rate_change: continueRate, charge_change: continueCharge, late_policy: continueLate };

// One step: previewed against the live debt with its own pending id (a fresh one unless the caller passes the id it already holds); the chain rides in its pending.
async function runStep(deps, ctx, chain, step, id = deps.ids.pending()) {
  const stepCtx = { ...ctx, previous: null, chain };
  const debt = (await loadDebts(deps)).find((item) => item.$id === chain.debtId);
  if (!debt) return inform(deps, stepCtx, 'No encontré esa deuda.');
  return STEP_RUNNERS[step.a](deps, stepCtx, id, debt, step.d);
}

async function startChain(deps, ctx, debt, proposal, id) {
  const planned = planChain(debt.$id, proposal.steps);
  if (!planned) return inform(deps, ctx, TOO_MANY_STEPS);
  await notify(deps, ctx, checklistText(debt.name, proposal));
  return runStep(deps, ctx, planned.chain, planned.step, id);
}

async function continueAdjust(deps, ctx, id, setupCase, legal) {
  const tables = legal || (await loadLegal(deps));
  const visible = (await loadDebts(deps, tables)).filter(inScopeFor(ctx.profile.ownerScope));
  const target = findDebt(visible, setupCase.debtRef).match || null;
  const proposal = proposeSetup(setupCase, target ? [{ ...target, events: await loadEvents(deps, target.$id) }] : visible, tables, today(deps));
  if (proposal.invalid.length > 0) return inform(deps, ctx, proposal.invalid.map((item) => item.text).join('\n'));
  const unsupported = proposal.unsupported.map((item) => item.text);
  const [question] = proposal.questions;
  if (question) {
    const stage = ADJUST_STAGE[question.field] || 'answers';
    let pending;
    try {
      pending = buildPending({ id, action: 'setup', awaiting: stage, debtId: target.$id, draft: { setup: setupCase } });
    } catch (error) {
      if (error.code !== 'pending_too_large') throw error;
      return inform(deps, ctx, TOO_MANY_STEPS);
    }
    return say(deps, ctx, { text: [question.text, ...unsupported].join('\n\n'), keyboard: ADJUST_KEYBOARDS[stage] && ADJUST_KEYBOARDS[stage](), status: STATUS[stage], pending });
  }
  if (proposal.steps.length === 0) return inform(deps, ctx, [...proposal.assumptions.map((item) => item.text), ...unsupported].join('\n'));
  return startChain(deps, ctx, target, proposal, id);
}

async function continueSetup(deps, ctx, id, setupCase, legal) {
  if (setupCase.adjust) return continueAdjust(deps, ctx, id, setupCase, legal);
  const proposal = proposeSetup(setupCase, [], legal || (await loadLegal(deps)), today(deps));
  const stage = setupStage(proposal);
  // `asked` are the cycle fields this reply really asks (a stuck question is not asked again; a lone convention question asks none):
  // the next message that answers none of them marks them unknown, and one that answers some does not.
  const asked = stage === 'convention' ? [] : proposal.questions.filter((question) => !question.stuck && SETUP_TRACKED.includes(question.field)).map((question) => question.field);
  let pending;
  try {
    pending = buildPending({ id, action: 'setup', awaiting: stage, draft: { setup: { ...setupCase, asked } } });
  } catch (error) {
    if (error.code !== 'pending_too_large') throw error;
    return inform(deps, ctx, TOO_MANY_CHARGES);
  }
  const keyboard = SETUP_KEYBOARDS[stage] ? SETUP_KEYBOARDS[stage]() : undefined;
  return say(deps, ctx, { text: setupText(setupCase, proposal, stage), keyboard, status: STATUS[stage], pending });
}

// A message that describes a different debt than the open case (S6x, owner decision) is not merged: Nia asks «¿Es otra deuda?». The pending keeps the
// open case untouched and the compact extraction of the new message, so «Empezar una nueva» needs no second model call.
async function askOtherDebt(deps, ctx, open, request) {
  const name = open.draft.setup.name || 'sin nombre';
  let pending;
  try {
    pending = buildPending({ id: open.id, action: 'setup', awaiting: 'other', ...(open.debtId ? { debtId: open.debtId } : {}), draft: { setup: open.draft.setup, next: compactCase(request.setup) } });
  } catch (error) {
    if (error.code !== 'pending_too_large') throw error;
    return inform(deps, ctx, `Tengo abierta la configuración de «${name}» y este mensaje parece describir otra deuda, pero son demasiados datos para guardar las dos a la vez. Termina o cancela la actual y luego escríbeme la nueva; no guardé nada.`);
  }
  const text = `Tengo abierta la configuración de «${name}» y este mensaje parece describir otra deuda. ¿Es otra deuda?\n\nSi sigues con la actual, retomo sus preguntas. Si empiezas una nueva, descarto la actual y armo la nueva con lo que acabas de escribir. Todavía no guardé nada.`;
  return say(deps, ctx, { text, keyboard: otherDebtKeyboard(), status: STATUS.other, pending });
}

async function startSetup(deps, ctx, request, legal, debts) {
  const open = isOpenSetup(ctx.previous) ? ctx.previous : null;
  if (open && isOtherDebt(open.draft.setup, request.setup, { debts: debts.filter(inScopeFor(ctx.profile.ownerScope)), openDebtId: open.debtId || null })) return askOtherDebt(deps, ctx, open, request);
  return continueSetup(deps, ctx, open ? open.id : deps.ids.pending(), mergeCase(open ? open.draft.setup : null, request.setup), legal);
}

/**
 * Entry point for a message classified as `debt`: extracts, validates, previews and asks for
 * what is missing. Nothing is written here.
 * @param {object} deps See the file header.
 * @param {{ chatId: string, actorId: string, profile: object, text: string, history: object[], previous: (object | null), sessionStatus?: string }} ctx
 */
export async function handleDebt(deps, ctx) {
  const asOf = today(deps);
  const legal = await loadLegal(deps);
  const debts = await loadDebts(deps, legal);
  const open = isOpenSetup(ctx.previous) ? ctx.previous.draft.setup : null;
  const raw = await deps.gemini(debtPrompt(ctx.text, debts, ctx.history, { today: asOf, timezone: deps.config.timezone, currency: deps.config.currency, setup: open && { kind: open.kind, name: open.name } }));
  const request = normaliseDebtExtraction(raw, { today: asOf });
  if (request.problems.length) return inform(deps, ctx, PROBLEMS[request.problems[0]]);
  if (request.setup) return startSetup(deps, ctx, request, legal, debts);
  // G3: a write action of the extraction wins over the router's hint; a read-only list or advise with the hint becomes the explanation.
  if (request.action === 'explain' || (ctx.explainHint && ['list', 'advise'].includes(request.action))) return startExplain(deps, ctx, request, debts, legal);
  if (request.action === 'list') return inform(deps, ctx, listReply(await summaries(deps, debts, asOf)));
  if (request.action === 'pay') return startPay(deps, ctx, request, debts);
  if (request.action === 'create') {
    if (request.missingFields.length) return inform(deps, ctx, `Para registrar la deuda necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
    return finishCreate(deps, ctx, deps.ids.pending(), request.create, legal);
  }
  if (request.action === 'legal_rate') return startLegalRate(deps, ctx, request);
  if (request.action === 'rate_change') return startRateChange(deps, ctx, request, debts);
  if (request.action === 'charge_change') return startChargeChange(deps, ctx, request, debts);
  if (request.action === 'restructure') return startRestructure(deps, ctx, request, debts);
  if (request.action === 'terms_correction') return startTermsCorrection(deps, ctx, request, debts);
  if (request.action === 'late_policy') return startLatePolicy(deps, ctx, request, debts);
  return startAnalysis(deps, ctx, request, debts);
}

const STALE_BUTTON = 'Esa opción ya no aplica a la solicitud actual.';

// «¿Es otra deuda?» (S6x): `keep` asks the open questions again with the open case as it was; `new` drops it and starts the stored extraction as a new case
// (a new pending id, so the old debt row id and event key are never reused).
function answerOtherDebt(deps, ctx, pending, answer) {
  const { setup, next } = pending.draft || {};
  if (!setup || !next) return notify(deps, ctx, STALE_BUTTON);
  if (answer === 'keep') return continueSetup(deps, ctx, pending.id, setup);
  return continueSetup(deps, { ...ctx, previous: null }, deps.ids.pending(), mergeCase(null, expandCase(next, today(deps))));
}

// A plan change that stated a rate with no convention keeps the value in its draft until the button arrives; then it goes on with the rate.
const withStatedRate = (next) => async (deps, ctx, pending, convention) => {
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return notify(deps, ctx, 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.');
  const { rateValue, ...draft } = pending.draft;
  return next(deps, ctx, pending.id, debt, { ...draft, rate: normalizeRate({ convention, value: rateValue }) });
};

// Where a `nia:conv:` button leads, by the action of the pending request: create finishes the new debt, rate_change and restructure go on
// to the mode or the preview with the rate the user stated, late_policy to the preview with the fixed mora rate.
const CONVENTION_NEXT = {
  create: (deps, ctx, pending, convention) => finishCreate(deps, ctx, pending.id, withConvention(pending.draft.create, convention)),
  rate_change: withStatedRate(continueRate),
  restructure: withStatedRate(continueRestructure),
  terms_correction: withStatedRate(continueCorrection),
  setup: async (deps, ctx, pending, convention) => {
    const { setup } = pending.draft;
    let rate;
    try {
      rate = normalizeRate({ convention, value: setup.rateValue });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      return inform(deps, ctx, PROBLEMS.invalid_rate);
    }
    return continueSetup(deps, ctx, pending.id, { ...setup, rate });
  },
  late_policy: async (deps, ctx, pending, convention) => {
    const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
    if (!debt) return notify(deps, ctx, 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.');
    const { rateValue, late, ...draft } = pending.draft;
    return continueLate(deps, ctx, pending.id, debt, { ...draft, late: { ...late, rate: normalizeRate({ convention, value: rateValue }) } });
  },
};

/**
 * `nia:pick:`, `nia:strat:`, `nia:conv:`, `nia:mode:` and `nia:simpay` buttons (`simpay` turns the last simulation into a payment preview;
 * `conv` goes to `CONVENTION_NEXT[pending.action]`; `mode` sets the mode of a pending rate change). A button that does not match the
 * pending request (stale) is answered with a short message and writes nothing.
 * @param {object} deps
 * @param {{ chatId: string, actorId: string, profile: object, history: object[], pending: (object | null) }} ctx `pending` is the session's pending payload.
 * @param {string} data The callback data.
 */
export async function handleDebtCallback(deps, rawCtx, data) {
  const action = parseCallback(data);
  if (!action) return undefined;
  const { pending } = rawCtx;
  // The buttons of a step of an adjustment chain keep the chain: whatever the step saves next carries it.
  const ctx = pending && pending.chain ? { ...rawCtx, previous: null, chain: pending.chain } : rawCtx;
  if (!pending || pending.kind !== 'debt' || pending.done) return notify(deps, ctx, 'No tengo una solicitud de deuda pendiente.');
  const stage = { pick: 'pick', strategy: 'strategy', convention: 'convention', simpay: 'simpay', mode: 'mode', charge: 'charge', minimum: 'minimum', adjust: 'adjust_kind', other: 'other' }[action.type];
  if (pending.awaiting !== stage || (action.type === 'mode' && pending.action !== 'rate_change') || (action.type === 'charge' && pending.action !== 'charge_change') || (['minimum', 'adjust', 'other'].includes(action.type) && pending.action !== 'setup')) return notify(deps, ctx, STALE_BUTTON);
  if (action.type === 'other') return answerOtherDebt(deps, ctx, pending, action.value);
  if (action.type === 'adjust') return continueSetup(deps, ctx, pending.id, { ...pending.draft.setup, adjustKind: action.value });
  if (action.type === 'convention') return CONVENTION_NEXT[pending.action] ? CONVENTION_NEXT[pending.action](deps, ctx, pending, action.value) : notify(deps, ctx, STALE_BUTTON);
  if (action.type === 'minimum') {
    const { setup } = pending.draft;
    return continueSetup(deps, ctx, pending.id, { ...setup, card: { ...setup.card, minRule: action.value }, unknown: (setup.unknown || []).filter((field) => field !== 'minRule') });
  }
  if (action.type === 'charge' && !pending.candidates[action.value]) return notify(deps, ctx, 'Ese cargo no es una de las opciones. Elige uno de la lista o escríbeme de nuevo.');
  if (action.type === 'pick' && !pending.candidates.includes(action.value)) return notify(deps, ctx, 'Esa deuda no es una de las opciones. Elige una de la lista o escríbeme de nuevo.');
  const debts = await loadDebts(deps);
  const debt = debts.find((item) => item.$id === (action.type === 'pick' ? action.value : pending.debtId));
  if (!debt) return notify(deps, ctx, 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.');
  if (pending.action === 'rate_change') return continueRate(deps, ctx, pending.id, debt, action.type === 'mode' ? { ...pending.draft, mode: action.value } : pending.draft);
  if (pending.action === 'charge_change') return continueCharge(deps, ctx, pending.id, debt, action.type === 'charge' ? { ...pending.draft, chargeId: pending.candidates[action.value] } : pending.draft);
  if (pending.action === 'restructure') return continueRestructure(deps, ctx, pending.id, debt, pending.draft);
  if (pending.action === 'terms_correction') return continueCorrection(deps, ctx, pending.id, debt, pending.draft);
  if (pending.action === 'late_policy') return continueLate(deps, ctx, pending.id, debt, pending.draft);
  if (action.type === 'pick' && pending.action !== 'pay') return runAnalysis(deps, ctx, pending.action, pending.id, debt, pending.draft, debts);
  // A simulation becomes a payment dated today with the strategy it was simulated with. The pending id stays, so the dedupe key does too.
  const draft = action.type === 'strategy' ? { ...pending.draft, strategy: action.value } : action.type === 'simpay' ? { ...pending.draft, effectiveOn: today(deps) } : pending.draft;
  return continuePay(deps, ctx, pending.id, debt, draft);
}

async function commitPay(deps, ctx, pending, asOf) {
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return { text: 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.', failed: true };
  const events = await loadEvents(deps, debt.$id);
  const plan = planCommit(debt, events, pending.draft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  return { duplicate, text: `✅ Listo: registré el abono de ${pesos(pending.draft.amountMinor)} a ${debt.name}. Saldo: ${pesos(plan.projection.balanceMinor)}.` };
}

// The debt row `db{id}` and, for a loan, its `disbursement` (a card has none: its opening balance lives in the terms, as in the web's `saveLoan`).
// The event goes first and is unique by `debt:{id}`; the row id is deterministic, so a 409 on it means an earlier Confirm already created it.
async function writeNewDebt(deps, ctx, pending, { name, lender, terms }) {
  const id = debtRowId(pending);
  const data = {
    householdId: deps.config.householdId,
    name,
    kind: terms.kind,
    ownerScope: ctx.profile.ownerScope,
    ...(lender ? { lender } : {}),
    status: 'active',
    currency: terms.unit,
    principalMinor: terms.principalMinor,
    openedOn: terms.openedOn,
    termsJson: serializeTerms(terms),
    termsVersion: 1,
    actorId: ctx.profile.appwriteUserId,
  };
  let duplicate = true;
  if (terms.kind !== 'card') {
    const disbursement = { kind: 'disbursement', effectiveOn: terms.openedOn, amountMinor: terms.principalMinor };
    const eventCtx = { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram' };
    ({ duplicate } = await commitPlan(debtPort(deps), planCommit({ ...data, $id: id }, [], disbursement, eventCtx)));
  }
  let existed = false;
  try {
    await deps.createRow(T.debts, { id, data });
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    existed = true;
  }
  return { duplicate: duplicate && existed };
}

async function commitCreate(deps, ctx, pending) {
  const terms = buildTerms(pending.draft.create);
  const { name, lender } = pending.draft.create;
  const { duplicate } = await writeNewDebt(deps, ctx, pending, { name, lender, terms });
  return { duplicate, text: `✅ Listo: registré la deuda «${name}» por ${pesos(terms.principalMinor)}.` };
}

// A described debt (S5c): the pending holds the case and the terms are rebuilt here. The stored row (and, for a loan, the event) is looked up first,
// so a repeated Confirm answers «ya estaba registrada» without rebuilding terms that may no longer be buildable.
async function commitSetup(deps, ctx, pending) {
  const setup = pending.draft.setup;
  const rows = await deps.listRows(T.debts, { householdId: deps.config.householdId });
  if (rows.some((row) => row.$id === debtRowId(pending)) && (setup.kind === 'card' || (await debtPort(deps).findEventByDedupe(dedupeKeyOf(pending))))) return { duplicate: true };
  const terms = buildSetupTerms(setup);
  const { duplicate } = await writeNewDebt(deps, ctx, pending, { name: setup.name, lender: setup.lender, terms });
  const text = terms.kind === 'card'
    ? `✅ Listo: registré la tarjeta «${setup.name}» (corte el día ${terms.card.statementDay}, pago el día ${terms.card.dueDay}).`
    : `✅ Listo: registré la deuda «${setup.name}» por ${pesos(terms.principalMinor)}.`;
  return { duplicate, text };
}

// The row id is the same for the same key (core `legalRateId`), so a second save collides (409) and becomes an update:
// repeated confirmations leave one row, and a changed value on an existing key is reported as an update.
async function commitLegalRate(deps, ctx, pending) {
  if (!isStorableLegalRate(pending.draft)) return { text: 'No pude guardar esa tasa: los datos no son válidos. Escríbemela de nuevo.', failed: true };
  const { kind, modality, validFrom, validTo, value } = pending.draft;
  const id = legalRateId({ kind, modality, validFrom }, deps.config.householdId);
  const data = { householdId: deps.config.householdId, kind, modality, validFrom, validTo, value, source: LEGAL_SOURCE, verified: false, actorId: ctx.profile.appwriteUserId };
  let updated = false;
  try {
    await deps.createRow(T.legal, { id, data });
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    await deps.updateRow(T.legal, id, data);
    updated = true;
  }
  return { duplicate: false, text: `✅ Listo: ${updated ? 'actualicé' : 'registré'} ${describeLegalRate(pending.draft)}.` };
}

// A rate change is rebuilt from the live debt and its events: what is written is the user's date, rate and mode, and the figures in
// the reply are those of the debt as it is now (a payment recorded after the preview is part of them). The event is unique by
// `debt:{pendingId}`, so a repeated Confirm finds it and answers that it was already recorded.
async function commitRateChange(deps, ctx, pending) {
  const asOf = today(deps);
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return { text: 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.', failed: true };
  const events = await loadEvents(deps, debt.$id);
  const draft = { kind: 'rate_change', ...pending.draft };
  let plan;
  try {
    plan = planCommit(debt, events, draft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  } catch (error) {
    if (error instanceof ValidationError && error.code === 'installment_too_low') return { text: TOO_LOW_CONFIRM, failed: true };
    throw error;
  }
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  if (duplicate) return { duplicate };
  return { duplicate: false, text: describeRateChange(debt, draft, previewChange(debt, events, draft, { on: asOf })) };
}

// The charge set is rebuilt from the charges in force now, so a change made on the web after the preview is kept. A repeated Confirm
// finds its event by the dedupe key first: after a removal the charge is no longer there to rebuild from.
async function commitChargeChange(deps, ctx, pending) {
  const asOf = today(deps);
  if (await debtPort(deps).findEventByDedupe(dedupeKeyOf(pending))) return { duplicate: true };
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return { text: 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.', failed: true };
  const events = await loadEvents(deps, debt.$id);
  const rebuilt = rebuildCharges(chargesInForce(project(debt, events, asOf), events, asOf), pending.draft, { card: debt.kind === 'card' });
  if (rebuilt.gone) return { text: CHARGE_GONE_TEXT, failed: true };
  if (rebuilt.issue) return { text: rebuilt.issue, failed: true };
  const draft = { kind: 'charge_change', effectiveOn: pending.draft.effectiveOn, charges: rebuilt.charges };
  const plan = planCommit(debt, events, draft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  if (duplicate) return { duplicate };
  const figures = previewChange(debt, events, draft, { on: asOf });
  return { duplicate: false, text: pending.draft.op === 'add' ? describeChargeAdd(debt, rebuilt.added, pending.draft, figures) : describeChargeChange(debt, rebuilt.target, pending.draft, figures, rebuilt.dependents) };
}

// A restructure is rebuilt from the live debt and events: the carried balance written is the one of now, so a payment recorded after the preview is
// part of it. The dedupe key is checked first because, once written, the restructure changes the debt that a repeated Confirm would rebuild from.
async function commitRestructure(deps, ctx, pending) {
  const asOf = today(deps);
  if (await debtPort(deps).findEventByDedupe(dedupeKeyOf(pending))) return { duplicate: true };
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return { text: 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.', failed: true };
  const events = await loadEvents(deps, debt.$id);
  const built = rebuildRestructure({ debt, events, today: asOf, draft: pending.draft });
  if (!built.ok) return { text: built.issue, failed: true };
  const plan = planCommit(debt, events, built.eventDraft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  if (duplicate) return { duplicate };
  return { duplicate: false, text: describeRestructure(debt, built) };
}

// A correction is rebuilt from the live debt and its events: what is written is what the user stated, bound by the core to the terms version in force,
// and a value that became the stored one in the meantime is refused. The dedupe key is checked first, like the other plan changes. Nia does not
// reconcile: the reply carries the backdated note when a past cost changes.
async function commitTermsCorrection(deps, ctx, pending) {
  const asOf = today(deps);
  if (await debtPort(deps).findEventByDedupe(dedupeKeyOf(pending))) return { duplicate: true };
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return { text: 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.', failed: true };
  const events = await loadEvents(deps, debt.$id);
  const built = rebuildCorrection({ debt, events, today: asOf, draft: pending.draft });
  if (!built.ok) return { text: built.issue, failed: true };
  const plan = planCommit(debt, events, built.eventDraft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  if (duplicate) return { duplicate };
  return { duplicate: false, text: describeCorrection(debt, built) };
}

// A mora policy is rebuilt from the live debt: the figures in the reply are those of the debt as it is now. The dedupe key is checked first,
// like the other plan changes, so a repeated Confirm answers that it was already recorded without reading the debt again.
async function commitLatePolicy(deps, ctx, pending) {
  const asOf = today(deps);
  if (await debtPort(deps).findEventByDedupe(dedupeKeyOf(pending))) return { duplicate: true };
  const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
  if (!debt) return { text: 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.', failed: true };
  const events = await loadEvents(deps, debt.$id);
  const draft = { kind: 'late_policy', ...pending.draft };
  const plan = planCommit(debt, events, draft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  if (duplicate) return { duplicate };
  return { duplicate: false, text: describeLatePolicy({ debt, draft: pending.draft, figures: previewChange(debt, events, draft, { on: asOf }), today: asOf }) };
}

const COMMIT = { create: commitCreate, setup: commitSetup, legal_rate: commitLegalRate, rate_change: commitRateChange, charge_change: commitChargeChange, restructure: commitRestructure, terms_correction: commitTermsCorrection, late_policy: commitLatePolicy };
const ALREADY = { pay: 'Este abono ya estaba registrado. No lo repetí.', create: 'Esta deuda ya estaba registrada. No la repetí.', setup: 'Esta deuda ya estaba registrada. No la repetí.', legal_rate: 'Esta tasa ya estaba registrada. No la repetí.', rate_change: 'Este cambio de tasa ya estaba registrado. No lo repetí.', charge_change: 'Este cambio de cargos ya estaba registrado. No lo repetí.', restructure: 'Esta reestructuración ya estaba registrada. No la repetí.', terms_correction: 'Esta corrección ya estaba registrada. No la repetí.', late_policy: 'Esta mora ya estaba registrada. No la repetí.' };

/**
 * Confirm button (or /confirmar) for a debt pending. Exactly once: the event is unique by its
 * `dedupeKey` (`debt:{pendingId}`), the cost row has a deterministic id, and a 409 means "already
 * done", so a double tap, a race or a Telegram retry writes one event and at most one cost row.
 */
export async function confirmDebt(deps, ctx, pending, expectedId = null) {
  if (expectedId && pending.id !== expectedId) return notify(deps, ctx, STEP_RECORDED);
  if (pending.done) return notify(deps, ctx, ALREADY[pending.action]);
  if (pending.awaiting !== 'confirm') return notify(deps, ctx, pending.action === 'setup' ? 'Antes de confirmar necesito que respondas las preguntas pendientes, con un mensaje o con los botones.' : 'Antes de confirmar necesito que elijas una de las opciones de los botones anteriores.');
  let outcome;
  try {
    outcome = COMMIT[pending.action] ? await COMMIT[pending.action](deps, ctx, pending) : await commitPay(deps, ctx, pending, today(deps));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    outcome = { text: describeCoreError(error), failed: true };
  }
  // A step of a chain that fails stops the chain: nothing more is written and the reply says what was done and what was not run.
  if (outcome.failed) return pending.chain ? say(deps, { ...ctx, text: '' }, { text: chainReport(pending.chain, { issue: outcome.text }), status: 'completed', pending: null }) : notify(deps, ctx, outcome.text);
  const next = pending.chain ? advanceChain(pending.chain) : null;
  if (next) {
    await notify(deps, ctx, outcome.duplicate ? ALREADY[pending.action] : outcome.text);
    return runStep(deps, { ...ctx, text: '' }, next.chain, next.step);
  }
  const done = { kind: 'debt', v: 1, id: pending.id, action: pending.action, done: true };
  return say(deps, { ...ctx, text: '' }, { text: outcome.duplicate ? ALREADY[pending.action] : outcome.text, status: 'completed', pending: done });
}

/**
 * `nia:cancel` (or /cancelar) on a step of an adjustment chain: the step and the ones after it are not run, and the reply says what was done.
 * @param {object} deps
 * @param {{ chatId: string, actorId: string, history: object[] }} ctx
 * @param {object} pending The session's pending, with its `chain`.
 */
export async function cancelDebtChain(deps, ctx, pending) {
  return say(deps, { ...ctx, text: '' }, { text: chainReport(pending.chain, { cancelled: true }), status: 'cancelled', pending: null });
}
