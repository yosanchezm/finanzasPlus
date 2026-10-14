import { ValidationError, advise, commitPlan, compareStrategies, legalRateId, normalizeRate, planCommit, previewChange, project, resolveLegal, serializeTerms, toEffectiveAnnual } from '../../../packages/finance-core/index.js';
import { cashflowSignals, cashflowWindow, inScopeFor } from './cashflow.js';
import { debtPrompt, normaliseDebtExtraction } from './extract.js';
import { MAX_CANDIDATES, findDebt, fold } from './findDebt.js';
import { isoDateIn, pesos } from './format.js';
import { guardParaphrase } from './guard.js';
import { describeLegalRate, isStorableLegalRate, previewLegalRate } from './legal.js';
import { buildPending, chargeKeyboard, confirmKeyboard, conventionKeyboard, debtRowId, dedupeKeyOf, eventIdOf, modeKeyboard, parseCallback, pickKeyboard, simulateKeyboard, strategyKeyboard } from './pending.js';
import { ADD_IN_WEB, CHARGE_GONE_TEXT, TOO_LOW_CONFIRM, chargesInForce, describeChargeChange, describeRateChange, previewChargeChange, previewRateChange, rebuildCharges } from './planChange.js';
import { conventionQuestion, describeCoreError, previewCreate, previewPay, buildTerms, withConvention } from './preview.js';
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
const COST_CATEGORY = { name: 'Costos financieros', kind: 'need', color: '#7A5AF8', icon: 'receipt' };
const STATUS = { confirm: 'awaiting_confirmation', pick: 'awaiting_clarification', strategy: 'awaiting_clarification', convention: 'awaiting_clarification', simpay: 'awaiting_clarification', mode: 'awaiting_clarification', charge: 'awaiting_clarification' };
const PARAPHRASE_TIMEOUT_MS = 8000;
const LEGAL_SOURCE = 'Nia (Telegram)';

const CARDS_WEB = 'Simular y recomendar abonos aplica a préstamos con plan de cuotas; todavía no está disponible para tarjetas (ni en la web).';
const ASK_EXTRA = '¿Cuánto quieres abonar? Escríbeme el monto en pesos.';
const PROBLEMS = {
  negative_amount: 'El monto no puede ser negativo. Escríbelo de nuevo, por ejemplo: “pagué 500.000 al carro”.',
  invalid_amount: 'No entendí el monto. Escríbelo en pesos y sin decimales.',
  future_date: 'La fecha del pago no puede ser futura. ¿Qué día fue?',
  invalid_rate: 'La tasa no es válida: debe ser desde 0 y, si es anticipada, menor a 100 % por periodo. ¿Cuál es?',
  card_in_web: 'Las tarjetas se crean desde la web, en la sección Deudas. Aquí puedo registrar abonos a una tarjeta que ya exista.',
  legal_value_out_of_range: 'Ese valor no parece una tasa válida: debe estar entre 5 % y 100 % E.A. y tener máximo dos decimales (por ejemplo, 28.2). Escríbelo de nuevo; no guardé nada.',
  legal_smmlv_out_of_range: 'El salario mínimo debe estar entre $ 100.000 y $ 100.000.000, en pesos enteros. Escríbelo de nuevo; no guardé nada.',
  legal_mortgage_needs_usury: 'Para la hipoteca registra directamente la tasa de usura: el IBC no la deriva. Dime la usura y el mes; no guardé nada.',
  legal_unknown_modality: 'No reconozco esa modalidad. Puede ser consumo y ordinario, bajo monto, productivo (rural o urbano), popular (rural o urbano) o hipotecario.',
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
  charge_action: 'si quieres cambiar su valor o quitarlo',
  charge_value: 'el nuevo valor',
};

const hasStatus = (error, status) => Boolean(error) && (error.status === status || error.code === status);
const clip = (value) => String(value || '').trim().slice(0, 700);

function turn(history, user, reply) {
  const items = [...(history || [])];
  if (clip(user)) items.push({ role: 'user', content: clip(user) });
  if (clip(reply)) items.push({ role: 'assistant', content: clip(reply) });
  return items.slice(-10);
}

// Saves the session (and the turn) and then answers.
async function say(deps, ctx, { text, keyboard, status, pending }) {
  await deps.saveSession(ctx.chatId, ctx.actorId, status, pending, turn(ctx.history, ctx.text, text));
  await deps.sendMessage(ctx.chatId, clampTelegram(text), keyboard);
}

// Answers without touching the session: the pending request, if any, stays as it was.
const inform = (deps, ctx, text) => say(deps, ctx, { text, status: ctx.sessionStatus || 'conversation', pending: ctx.previous || null });
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
        nextDue: nextDue ? { dueOn: nextDue.dueOn, amountMinor: nextDue.outstandingMinor } : null,
        eaPercent: toEffectiveAnnual(projection.terms.rate),
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
    return inform(deps, ctx, 'Esa deuda tiene demasiados cargos para registrarla por Telegram. Créala desde la web, en la sección Deudas.');
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

// A charge change (NI2, NI6): Nia edits the value of a charge the debt already has, or removes it; adding one is web-only. The pending
// stores the charge id, the operation and the value; the whole charge set is rebuilt from the live debt at Confirm.
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
  if (op === 'add') return inform(deps, ctx, ADD_IN_WEB);
  if (request.missingFields.length) return inform(deps, ctx, `Para cambiar un seguro o cargo necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
  const draft = { effectiveOn, chargeRef, op, newValue };
  return withDebt(deps, ctx, request, debts, { action: 'charge_change', draft, question: '¿A cuál deuda le cambio el seguro o cargo?' }, (id, debt) => continueCharge(deps, ctx, id, debt, draft));
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
async function paraphrase(deps, facts, name) {
  try {
    const raw = await withTimeout(deps.gemini(paraphrasePrompt(facts, name)), deps.config.paraphraseTimeoutMs || PARAPHRASE_TIMEOUT_MS);
    return guardParaphrase(raw && raw.reply, facts, [name]);
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
  return inform(deps, ctx, (await paraphrase(deps, facts, debt.name)) || adviseReply(facts, debt.name));
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
  const raw = await deps.gemini(debtPrompt(ctx.text, debts, ctx.history, { today: asOf, timezone: deps.config.timezone, currency: deps.config.currency }));
  const request = normaliseDebtExtraction(raw, { today: asOf });
  if (request.problems.length) return inform(deps, ctx, PROBLEMS[request.problems[0]]);
  if (request.action === 'list') return inform(deps, ctx, listReply(await summaries(deps, debts, asOf)));
  if (request.action === 'pay') return startPay(deps, ctx, request, debts);
  if (request.action === 'create') {
    if (request.missingFields.length) return inform(deps, ctx, `Para registrar la deuda necesito: ${request.missingFields.map((field) => MISSING[field]).join(', ')}.`);
    return finishCreate(deps, ctx, deps.ids.pending(), request.create, legal);
  }
  if (request.action === 'legal_rate') return startLegalRate(deps, ctx, request);
  if (request.action === 'rate_change') return startRateChange(deps, ctx, request, debts);
  if (request.action === 'charge_change') return startChargeChange(deps, ctx, request, debts);
  return startAnalysis(deps, ctx, request, debts);
}

const STALE_BUTTON = 'Esa opción ya no aplica a la solicitud actual.';

// Where a `nia:conv:` button leads, by the action of the pending request: create finishes the new debt, rate_change goes on to
// the mode or the preview with the rate the user stated (the value is kept in the draft until the convention arrives).
const CONVENTION_NEXT = {
  create: (deps, ctx, pending, convention) => finishCreate(deps, ctx, pending.id, withConvention(pending.draft.create, convention)),
  rate_change: async (deps, ctx, pending, convention) => {
    const debt = (await loadDebts(deps)).find((item) => item.$id === pending.debtId);
    if (!debt) return notify(deps, ctx, 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.');
    const { rateValue, ...draft } = pending.draft;
    return continueRate(deps, ctx, pending.id, debt, { ...draft, rate: normalizeRate({ convention, value: rateValue }) });
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
export async function handleDebtCallback(deps, ctx, data) {
  const action = parseCallback(data);
  if (!action) return undefined;
  const { pending } = ctx;
  if (!pending || pending.kind !== 'debt' || pending.done) return notify(deps, ctx, 'No tengo una solicitud de deuda pendiente.');
  const stage = { pick: 'pick', strategy: 'strategy', convention: 'convention', simpay: 'simpay', mode: 'mode', charge: 'charge' }[action.type];
  if (pending.awaiting !== stage || (action.type === 'mode' && pending.action !== 'rate_change') || (action.type === 'charge' && pending.action !== 'charge_change')) return notify(deps, ctx, STALE_BUTTON);
  if (action.type === 'convention') return CONVENTION_NEXT[pending.action] ? CONVENTION_NEXT[pending.action](deps, ctx, pending, action.value) : notify(deps, ctx, STALE_BUTTON);
  if (action.type === 'charge' && !pending.candidates[action.value]) return notify(deps, ctx, 'Ese cargo no es una de las opciones. Elige uno de la lista o escríbeme de nuevo.');
  if (action.type === 'pick' && !pending.candidates.includes(action.value)) return notify(deps, ctx, 'Esa deuda no es una de las opciones. Elige una de la lista o escríbeme de nuevo.');
  const debts = await loadDebts(deps);
  const debt = debts.find((item) => item.$id === (action.type === 'pick' ? action.value : pending.debtId));
  if (!debt) return notify(deps, ctx, 'No encontré esa deuda. Escríbeme de nuevo qué quieres registrar.');
  if (pending.action === 'rate_change') return continueRate(deps, ctx, pending.id, debt, action.type === 'mode' ? { ...pending.draft, mode: action.value } : pending.draft);
  if (pending.action === 'charge_change') return continueCharge(deps, ctx, pending.id, debt, action.type === 'charge' ? { ...pending.draft, chargeId: pending.candidates[action.value] } : pending.draft);
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

async function commitCreate(deps, ctx, pending) {
  const terms = buildTerms(pending.draft.create);
  const { name, lender } = pending.draft.create;
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
  const disbursement = { kind: 'disbursement', effectiveOn: terms.openedOn, amountMinor: terms.principalMinor };
  const eventCtx = { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram' };
  const { duplicate } = await commitPlan(debtPort(deps), planCommit({ ...data, $id: id }, [], disbursement, eventCtx));
  let existed = false;
  try {
    await deps.createRow(T.debts, { id, data });
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    existed = true;
  }
  return { duplicate: duplicate && existed, text: `✅ Listo: registré la deuda «${name}» por ${pesos(terms.principalMinor)}.` };
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
  const rebuilt = rebuildCharges(chargesInForce(project(debt, events, asOf), events, asOf), pending.draft);
  if (rebuilt.gone) return { text: CHARGE_GONE_TEXT, failed: true };
  const draft = { kind: 'charge_change', effectiveOn: pending.draft.effectiveOn, charges: rebuilt.charges };
  const plan = planCommit(debt, events, draft, { eventId: eventIdOf(pending), dedupeKey: dedupeKeyOf(pending), actorId: ctx.profile.appwriteUserId, source: 'telegram', asOf });
  const { duplicate } = await commitPlan(debtPort(deps), plan);
  if (duplicate) return { duplicate };
  return { duplicate: false, text: describeChargeChange(debt, rebuilt.target, pending.draft, previewChange(debt, events, draft, { on: asOf }), rebuilt.dependents) };
}

const COMMIT = { create: commitCreate, legal_rate: commitLegalRate, rate_change: commitRateChange, charge_change: commitChargeChange };
const ALREADY = { pay: 'Este abono ya estaba registrado. No lo repetí.', create: 'Esta deuda ya estaba registrada. No la repetí.', legal_rate: 'Esta tasa ya estaba registrada. No la repetí.', rate_change: 'Este cambio de tasa ya estaba registrado. No lo repetí.', charge_change: 'Este cambio de cargos ya estaba registrado. No lo repetí.' };

/**
 * Confirm button (or /confirmar) for a debt pending. Exactly once: the event is unique by its
 * `dedupeKey` (`debt:{pendingId}`), the cost row has a deterministic id, and a 409 means "already
 * done", so a double tap, a race or a Telegram retry writes one event and at most one cost row.
 */
export async function confirmDebt(deps, ctx, pending) {
  if (pending.done) return notify(deps, ctx, ALREADY[pending.action]);
  if (pending.awaiting !== 'confirm') return notify(deps, ctx, 'Antes de confirmar necesito que elijas una de las opciones de los botones anteriores.');
  let outcome;
  try {
    outcome = COMMIT[pending.action] ? await COMMIT[pending.action](deps, ctx, pending) : await commitPay(deps, ctx, pending, today(deps));
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return notify(deps, ctx, describeCoreError(error));
  }
  if (outcome.failed) return notify(deps, ctx, outcome.text);
  const done = { kind: 'debt', v: 1, id: pending.id, action: pending.action, done: true };
  return say(deps, { ...ctx, text: '' }, { text: outcome.duplicate ? ALREADY[pending.action] : outcome.text, status: 'completed', pending: done });
}
