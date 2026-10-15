import { createHash, randomUUID } from 'node:crypto';
import { Blob } from 'node:buffer';
import undici from 'undici';
import { parseThresholds } from './debt/cashflow.js';
import { paraphraseEnabled } from './debt/explain/paraphrase.js';
import { glossaryTopic } from './debt/explain/router.js';
import { answersOpenSetup, confirmDebt, debtSummaries, handleDebt, handleDebtCallback, handleExplainCallback, lastExplain } from './debt/handler.js';

const { FormData, fetch } = undici;

const env = process.env;
const config = {
  appwriteEndpoint: (env.APPWRITE_ENDPOINT || env.APPWRITE_FUNCTION_API_ENDPOINT || '').replace(/\/$/, ''),
  projectId: env.APPWRITE_PROJECT_ID || env.APPWRITE_FUNCTION_PROJECT_ID || '',
  apiKey: env.APPWRITE_API_KEY || '',
  databaseId: env.APPWRITE_DATABASE_ID || '',
  teamId: env.HOUSEHOLD_TEAM_ID || '',
  householdId: env.HOUSEHOLD_ID || '',
  currency: (env.HOUSEHOLD_CURRENCY || 'COP').toUpperCase(),
  timezone: env.HOUSEHOLD_TIMEZONE || 'America/Bogota',
  bucketId: env.RECEIPTS_BUCKET_ID || 'receipts',
  telegramToken: env.TELEGRAM_BOT_TOKEN || '',
  telegramSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
  geminiKey: env.GEMINI_API_KEY || '',
  model: env.AI_MODEL || 'gemini-3.5-flash-lite',
  webUrl: (env.NIA_WEB_URL || '').trim().replace(/\/$/, ''),
  adviceThresholds: parseThresholds(env.DEBT_ADVICE_THRESHOLDS),
  explainParaphrase: paraphraseEnabled(env.NIA_EXPLAIN_PARAPHRASE), // off unless explicitly on: it adds a Gemini call to every explanation
};

const TABLES = {
  sessions: 'bot_sessions',
  events: 'ai_events',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  goals: 'goals',
  attachments: 'attachments',
  debts: 'debts',
  debtEvents: 'debt_events',
};

let writeLog = () => {};
let writeError = () => {};

function errorReference(update) {
  const source = update?.update_id === undefined
    ? Date.now().toString(36)
    : String(update.update_id);
  return source.slice(-10).toUpperCase();
}

function errorHint(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('invalid query') || message.includes('syntax error') || message.includes('tablesdb')) {
    return 'no pude consultar o guardar los datos en Appwrite; puede ser un problema temporal o una tabla/campo mal configurado.';
  }
  if (message.includes('gemini') || message.includes('generativelanguage') || message.includes('quota') || message.includes('429') || message.includes('api key')) {
    return 'no pude interpretar la solicitud con Gemini; puede deberse a un límite temporal, al modelo o a la configuración de la API.';
  }
  if (message.includes('telegram') || message.includes('chat not found') || message.includes('bot was blocked') || message.includes('forbidden')) {
    return 'Telegram rechazó la operación; puede deberse a que el bot fue bloqueado, el chat no está disponible o el mensaje no es válido.';
  }
  if (message.includes('download') || message.includes('attachment') || message.includes('file') || message.includes('mime')) {
    return 'no pude leer el archivo adjunto; puede deberse a un formato no compatible o a que Telegram ya no permite descargarlo.';
  }
  if (message.includes('faltan variables') || message.includes('appwrite_') || message.includes('telegram_webhook_secret')) {
    return 'la Function no tiene completa su configuración de entorno en Appwrite.';
  }
  return 'ocurrió un problema temporal al procesar la solicitud en Telegram, Appwrite o Gemini.';
}

function failureMessage(reference, error) {
  return [
    '⚠️ No pude completar esta acción.',
    '',
    `Posible causa: ${errorHint(error)}`,
    '',
    `Referencia: NIA-${reference}`,
    'Intenta nuevamente en unos segundos. Si vuelve a ocurrir, comparte esta referencia con el administrador.',
  ].join('\n');
}

async function notifyFailure(update, error, reference) {
  const message = update?.message || update?.callback_query?.message;
  const chatId = chatFromMessage(message);
  if (!chatId) return;
  try {
    await sendMessage(chatId, failureMessage(reference, error));
  } catch (notificationError) {
    writeError(`Nia failure notification ${reference}: ${notificationError?.stack || notificationError?.message || String(notificationError)}`);
  }
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

function getHeader(req, wanted) {
  const headers = req?.headers || {};
  const target = wanted.toLowerCase();
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === target);
  return Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
}

function parseRequestBody(req) {
  if (req?.bodyJson && typeof req.bodyJson === 'object') return req.bodyJson;
  if (req?.body && typeof req.body === 'object') return req.body;
  return parseJson(req?.body || req?.bodyText || '{}', {});
}

function assertConfig() {
  const missing = [
    ['APPWRITE_ENDPOINT', config.appwriteEndpoint],
    ['APPWRITE_PROJECT_ID', config.projectId],
    ['APPWRITE_API_KEY', config.apiKey],
    ['APPWRITE_DATABASE_ID', config.databaseId],
    ['HOUSEHOLD_TEAM_ID', config.teamId],
    ['HOUSEHOLD_ID', config.householdId],
    ['TELEGRAM_BOT_TOKEN', config.telegramToken],
    ['TELEGRAM_WEBHOOK_SECRET', config.telegramSecret],
    ['GEMINI_API_KEY', config.geminiKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Faltan variables de Nia: ${missing.join(', ')}`);
}

function randomId() {
  return randomUUID().replaceAll('-', '').slice(0, 36);
}

function permission(action, role) {
  return `${action}("${role}")`;
}

function query(method, column, values) {
  const result = { method };
  // Appwrite self-hosted 1.8.1 expects `attribute` in REST query JSON.
  if (column !== undefined) result.attribute = column;
  if (values !== undefined) result.values = Array.isArray(values) ? values : [values];
  return JSON.stringify(result);
}

function queryEqual(field, value) {
  return query('equal', field, String(value));
}

function queryLimit(value) {
  return query('limit', undefined, Number(value));
}

function queryGreaterEqual(field, value) {
  return query('greaterThanEqual', field, String(value));
}

function queryLessThan(field, value) {
  return query('lessThan', field, String(value));
}

function queryCursorAfter(rowId) {
  return query('cursorAfter', undefined, String(rowId));
}

async function appwriteRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = {
    Accept: 'application/json',
    'X-Appwrite-Project': config.projectId,
    'X-Appwrite-Key': config.apiKey,
    ...headers,
  };
  if (body !== undefined && !(body instanceof FormData)) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${config.appwriteEndpoint}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    // `status` lets the debt core tell "already exists" (409) from real failures.
    throw Object.assign(new Error(`${method} ${path} → ${response.status}: ${data.message || data.raw || response.statusText}`), { status: response.status });
  }
  return data;
}

async function listRows(table, queries) {
  const params = new URLSearchParams();
  for (const query of queries) params.append('queries[]', query);
  const result = await appwriteRequest(`/tablesdb/${config.databaseId}/tables/${table}/rows?${params}`);
  return result.rows || [];
}

function queryOffset(value) {
  return query('offset', undefined, Number(value));
}

async function createRow(table, data, permissions = []) {
  return appwriteRequest(`/tablesdb/${config.databaseId}/tables/${table}/rows`, {
    method: 'POST',
    body: compactObject({ rowId: randomId(), data, permissions }),
  });
}

async function updateRow(table, rowId, data) {
  return appwriteRequest(`/tablesdb/${config.databaseId}/tables/${table}/rows/${encodeURIComponent(rowId)}`, {
    method: 'PATCH',
    body: { data: compactObject(data) },
  });
}

async function upsertRow(table, rowId, data, permissions) {
  return appwriteRequest(`/tablesdb/${config.databaseId}/tables/${table}/rows/${encodeURIComponent(rowId)}`, {
    method: 'PUT',
    body: compactObject({ data, permissions }),
  });
}

async function deleteRow(table, rowId) {
  return appwriteRequest(`/tablesdb/${config.databaseId}/tables/${table}/rows/${encodeURIComponent(rowId)}`, {
    method: 'DELETE',
  });
}

// Debt flow seam (functions/nia/debt/handler.js): thin adapters over the helpers above. Rows are flat,
// ids are chosen by the caller (deterministic ids make retries idempotent) and a 409 carries `status`.
const DEBT_ROW_ACTIONS = { debts: ['read', 'update'], debt_events: ['read'], transactions: ['read', 'update', 'delete'], categories: ['read', 'update'], legal_rates: ['read', 'update'] };
const DEBT_PAGE = 100;

async function debtListRows(table, where) {
  const filters = Object.entries(where).map(([field, value]) => queryEqual(field, value));
  const rows = [];
  for (let offset = 0; ; offset += DEBT_PAGE) {
    const page = await listRows(table, [...filters, queryLimit(DEBT_PAGE), queryOffset(offset)]);
    rows.push(...page.map((row) => ({ ...rowData(row), $id: row.$id, $createdAt: row.$createdAt })));
    if (page.length < DEBT_PAGE) return rows;
  }
}

// Income and expense rows of a time range, page by page with a cursor. More rows than the cap would give a
// wrong average, so that throws and the advice treats the cash flow as unknown.
const CASHFLOW_MAX_PAGES = 50;

async function cashflowRows({ from, to }) {
  const rows = [];
  let cursor;
  for (let page = 0; page < CASHFLOW_MAX_PAGES; page += 1) {
    const queries = [queryEqual('householdId', config.householdId), queryGreaterEqual('occurredAt', from), queryLessThan('occurredAt', to), queryLimit(DEBT_PAGE)];
    const batch = await listRows(TABLES.transactions, cursor ? [...queries, queryCursorAfter(cursor)] : queries);
    rows.push(...batch.map((row) => {
      const value = rowData(row);
      return { type: value.type, amountMinor: value.amountMinor, occurredAt: value.occurredAt, ownerScope: value.ownerScope };
    }));
    if (batch.length < DEBT_PAGE) return rows;
    cursor = batch[batch.length - 1].$id;
  }
  throw new Error('Too many transactions to average the cash flow.');
}

function debtCreateRow(table, { id, data }) {
  const permissions = (DEBT_ROW_ACTIONS[table] || ['read']).map((action) => permission(action, `team:${config.teamId}`));
  return appwriteRequest(`/tablesdb/${config.databaseId}/tables/${table}/rows`, { method: 'POST', body: compactObject({ rowId: id, data, permissions }) });
}

function debtDeps() {
  return {
    config: { householdId: config.householdId, timezone: config.timezone, currency: config.currency, webUrl: config.webUrl, adviceThresholds: config.adviceThresholds, explainParaphrase: config.explainParaphrase },
    cashflowRows,
    now: () => new Date(),
    ids: { pending: () => randomId().slice(0, 24) },
    listRows: debtListRows,
    createRow: debtCreateRow,
    updateRow, // PATCH /rows/{id}: a legal_rate Confirm on an existing key updates the row
    deleteRow,
    gemini: (prompt) => geminiJson([{ text: prompt }], 0.1),
    sendMessage,
    saveSession,
  };
}

async function telegramRequest(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: ${data.description || response.statusText}`);
  return data.result;
}

async function sendMessage(chatId, text, keyboard) {
  return telegramRequest('sendMessage', compactObject({
    chat_id: chatId,
    text,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  }));
}

function confirmationKeyboard() {
  return [[
    { text: 'Confirmar', callback_data: 'nia:confirm' },
    { text: 'Editar', callback_data: 'nia:edit' },
    { text: 'Cancelar', callback_data: 'nia:cancel' },
  ]];
}

function profileFor(telegramUserId) {
  const map = parseJson(env.TELEGRAM_USER_MAP || '{}', {});
  const profile = map[String(telegramUserId)];
  if (!profile) return null;
  const ownerScope = ['you', 'partner', 'shared'].includes(profile.ownerScope) ? profile.ownerScope : 'you';
  return {
    ownerScope,
    appwriteUserId: profile.appwriteUserId || `telegram:${telegramUserId}`,
    alias: profile.alias || ownerScope,
  };
}

function actorFromMessage(message) {
  return message?.from?.id === undefined ? null : String(message.from.id);
}

function chatFromMessage(message) {
  return message?.chat?.id === undefined ? null : String(message.chat.id);
}

async function getSession(chatId) {
  const rows = await listRows(TABLES.sessions, [
    queryEqual('householdId', config.householdId),
    queryEqual('channel', 'telegram'),
    queryEqual('externalChatId', chatId),
    queryLimit(1),
  ]);
  return rows[0] || null;
}

async function saveSession(chatId, actorId, status, pending, historyOverride) {
  const existing = await getSession(chatId);
  const history = historyOverride ?? historyFromSession(existing);
  const data = {
    householdId: config.householdId,
    channel: 'telegram',
    externalChatId: chatId,
    actorId,
    pendingJson: serialiseSession(pending, history),
    status,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  if (existing) return updateRow(TABLES.sessions, existing.$id, data);
  return createRow(TABLES.sessions, data, [permission('read', `team:${config.teamId}`), permission('update', `team:${config.teamId}`)]);
}

function sessionState(session) {
  if (!session?.pendingJson) return { pending: null, history: [] };
  if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) return { pending: null, history: [] };
  const parsed = parseJson(session.pendingJson, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ('pending' in parsed || 'history' in parsed)) {
    return {
      pending: parsed.pending || null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  }
  return { pending: parsed, history: [] };
}

function pendingFromSession(session) {
  return sessionState(session).pending;
}

function historyFromSession(session) {
  return sessionState(session).history;
}

function appendHistory(history, role, content) {
  const value = String(content || '').trim();
  if (!value) return history || [];
  return [...(history || []), { role, content: value.slice(0, 700) }].slice(-10);
}

function serialiseSession(pending, history) {
  const safeHistory = (history || []).slice(-10);
  let json = JSON.stringify({ pending: pending || null, history: safeHistory });
  while (json.length > 7600 && safeHistory.length > 1) {
    safeHistory.shift();
    json = JSON.stringify({ pending: pending || null, history: safeHistory });
  }
  return json;
}

async function getEvent(inputHash) {
  const rows = await listRows(TABLES.events, [queryEqual('inputHash', inputHash), queryLimit(1)]);
  return rows[0] || null;
}

async function recordEvent(pending, actorId, inputHash, status) {
  return createRow(TABLES.events, compactObject({
    householdId: config.householdId,
    actorId,
    channel: 'telegram',
    inputHash,
    extractedJson: JSON.stringify(pending),
    missingFields: pending.missingFields.join(','),
    confidence: pending.confidence,
    status,
  }), [permission('read', `team:${config.teamId}`)]);
}

async function downloadTelegramAttachment(message) {
  const item = message?.photo?.at(-1) || message?.document || message?.voice || message?.audio;
  if (!item?.file_id) return null;
  if (item.file_size && item.file_size > 10 * 1024 * 1024) throw new Error('El recibo supera el límite de 10 MB.');
  const file = await telegramRequest('getFile', { file_id: item.file_id });
  if (!file?.file_path) throw new Error('Telegram no entregó la ruta del archivo.');
  const response = await fetch(`https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`);
  if (!response.ok) throw new Error(`No se pudo descargar el recibo (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error('El recibo supera el límite de 10 MB.');
  const mimeType = message.document?.mime_type || message.voice?.mime_type || message.audio?.mime_type || (message.voice ? 'audio/ogg' : 'image/jpeg');
  const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1] || 'jpg';
  return {
    fileId: item.file_id,
    mimeType,
    name: message.document?.file_name || message.audio?.file_name || `adjunto-${Date.now()}.${extension}`,
    bytes,
  };
}

function localNow() {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: config.timezone,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(new Date());
}

function extractionPrompt(input, previous) {
  return [
    'Eres Nia, asistente de finanzas personales para un hogar de dos personas.',
    `La fecha y hora actual en ${config.timezone} es: ${localNow()}.`,
    `La moneda predeterminada del hogar es ${config.currency}.`,
    'Interpreta texto y recibos en español. Nunca inventes una fecha: si el usuario no indica hoy, ayer, una fecha concreta o una referencia resoluble, marca la fecha como faltante.',
    'Resuelve referencias como ayer, el viernes pasado o la semana pasada usando la fecha actual y la zona horaria. Si son ambiguas, marca date como faltante.',
    'El responsable debe ser you, partner o shared. Si el texto no aclara el responsable, usa null; el sistema aplicará el responsable configurado para quien envió el mensaje.',
    'Devuelve únicamente JSON válido, sin markdown, con exactamente estas claves:',
    '{"type":"expense|income|transfer","amountMinor":number|null,"currency":"COP","occurredAt":"ISO-8601|null","merchant":"string|null","category":"string|null","ownerScope":"you|partner|shared|null","note":"string|null","confidence":number,"missingFields":["amount|date|merchant|category|owner"]}',
    'Para COP amountMinor es un entero en pesos colombianos, no en centavos. No guardes nada; solo extrae y valida.',
    previous ? `Interpretación pendiente anterior:\n${JSON.stringify(previous)}` : 'No hay interpretación anterior.',
    `Nuevo mensaje del usuario:\n${input || '(solo se adjuntó una imagen o documento)'}`,
  ].join('\n\n');
}

function conversationContext(history) {
  return (history || [])
    .map((item) => `${item.role === 'assistant' ? 'Nia' : 'Usuario'}: ${item.content}`)
    .join('\n');
}

function assistantPrompt(input, previous, history, profile, attachment) {
  return [
    'Eres Nia, una asistente inteligente de finanzas personales para un hogar de dos personas.',
    `La fecha y hora actual en ${config.timezone} es: ${localNow()}.`,
    `La moneda predeterminada del hogar es ${config.currency}.`,
    `En este chat el usuario está configurado como ${profile.alias}, con alcance predeterminado ${profile.ownerScope}.`,
    'Puedes conversar, explicar conceptos, analizar finanzas y procesar textos, fotos, documentos y notas de voz.',
    'Clasifica cada mensaje con un intent: transaction para gastos, ingresos o transferencias; budget para presupuestos o límites por categoría; goal para metas y progreso; category para categorías; analysis para revisar, resumir, comparar o entender finanzas; debt para préstamos, deudas y tarjetas de crédito (crearlas, registrar un pago o abono, listarlas, simular un abono extra, pedir una recomendación de cómo abonar, registrar una tasa legal: la usura, el IBC o el salario mínimo, cambiar la tasa de una deuda que ya existe, cambiar o quitar un seguro o cargo de una deuda, configurar la mora de una deuda que ya existe, reestructurar una deuda que ya existe, o pedir que te expliquen un concepto de deudas como tasas y sus convenciones, usura, mora, cargos, GMF, corte de la tarjeta o abonos: la acción explain); conversation para preguntas generales, capacidades, identidad o educación financiera.',
    'Para debt solo identifica el intent: otra consulta extraerá los datos y el sistema hará los cálculos. Un pago a una deuda no es un transaction.',
    'Si la interpretación pendiente anterior es una solicitud de deuda (kind debt) que espera datos, un mensaje corto que responde sus preguntas (por ejemplo “el corte es el 15” o “no sé”) es debt.',
    'Para transaction, budget, goal o category, nunca afirmes que guardaste algo: el sistema mostrará una vista previa y esperará confirmación.',
    'Para transaction, interpreta texto y recibos en español. Nunca inventes una fecha: si no indica hoy, ayer, una fecha concreta o una referencia resoluble, marca date como faltante.',
    'Resuelve referencias como ayer, el viernes pasado o la semana pasada usando la fecha actual y la zona horaria. Si son ambiguas, marca date como faltante.',
    'El responsable debe ser you, partner o shared. Si no se aclara, usa null; el sistema aplicará el responsable configurado para quien envió el mensaje.',
    'Para presupuestos, convierte “este mes”, “el próximo mes” o una fecha indicada en month con formato YYYY-MM. Para metas, convierte fechas objetivo a YYYY-MM-DD. Para un aporte a una meta, usa action contribute y contributionMinor.',
    'Para actualizar o eliminar un movimiento, presupuesto, meta o categoría, completa selector con nombre, comercio, fecha, monto o ID cuando el usuario lo proporcione. Para consultar datos usa action list.',
    'Devuelve únicamente JSON válido, sin markdown, con exactamente estas claves de nivel superior:',
    '{"intent":"transaction|budget|goal|category|analysis|conversation|debt","action":"create|update|delete|contribute|list|none","reply":"string|null","transaction":{"type":"expense|income|transfer","amountMinor":number|null,"currency":"COP","occurredAt":"ISO-8601|null","merchant":"string|null","category":"string|null","ownerScope":"you|partner|shared|null","note":"string|null","confidence":number,"missingFields":["amount|date|merchant|category|owner"]},"budget":{"month":"YYYY-MM|null","category":"string|null","plannedMinor":number|null,"alertAtPercent":number|null},"goal":{"name":"string|null","targetMinor":number|null,"currentMinor":number|null,"contributionMinor":number|null,"targetDate":"YYYY-MM-DD|null","ownerScope":"you|partner|shared|null","status":"active|completed|paused|null"},"category":{"name":"string|null","kind":"need|want|saving|income|null","color":"string|null","icon":"string|null"},"selector":{"id":"string|null","name":"string|null","merchant":"string|null","date":"YYYY-MM-DD|null","amountMinor":number|null,"position":"latest|oldest|null"}}',
    'Para COP amountMinor es un entero en pesos colombianos, no en centavos. En conversation responde en español, con claridad y sin inventar datos. En analysis deja reply breve: el sistema consultará los datos reales. Para list no inventes resultados.',
    previous ? `Interpretación pendiente anterior:\n${JSON.stringify(previous)}` : 'No hay interpretación pendiente.',
    history?.length ? `Contexto reciente del chat:\n${conversationContext(history)}` : 'No hay contexto conversacional anterior.',
    `Nuevo mensaje del usuario:\n${input || '(solo se adjuntó una imagen o documento)'}`,
    attachment ? `Se adjuntó un archivo de tipo ${attachment.mimeType}; úsalo como evidencia multimodal.` : 'No hay archivo adjunto.',
  ].join('\n\n');
}

async function geminiJson(parts, temperature = 0.2) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.geminiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${data.error?.message || response.statusText}`);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini no devolvió una respuesta.');
  return parseJson(text.replace(/^```json\s*|```$/g, '').trim(), null) || (() => { throw new Error('Gemini devolvió JSON inválido.'); })();
}

async function askGemini(input, attachment, previous, history, profile) {
  const parts = [{ text: assistantPrompt(input, previous, history, profile, attachment) }];
  if (attachment) {
    parts.push({ inline_data: { mime_type: attachment.mimeType, data: attachment.bytes.toString('base64') } });
  }
  return geminiJson(parts, 0.2);
}

function rowData(row) {
  return row?.data && typeof row.data === 'object' ? row.data : row || {};
}

// Code-computed debt figures for the analysis intent. Unreadable debt tables just leave them out.
async function debtSnapshot() {
  try {
    return await debtSummaries(debtDeps());
  } catch (caught) {
    writeError(`No se pudieron leer las deudas para el análisis: ${caught?.message || caught}`);
    return null;
  }
}

async function workspaceSnapshot({ withDebts = false } = {}) {
  const [transactions, categories, budgets, goals] = await Promise.all([
    listRows(TABLES.transactions, [queryEqual('householdId', config.householdId), queryLimit(100)]),
    listRows(TABLES.categories, [queryEqual('householdId', config.householdId), queryLimit(100)]),
    listRows(TABLES.budgets, [queryEqual('householdId', config.householdId), queryLimit(100)]),
    listRows(TABLES.goals, [queryEqual('householdId', config.householdId), queryLimit(100)]),
  ]);
  const categoryNames = new Map(categories.map((row) => [row.$id, rowData(row).name]));
  const debts = withDebts ? await debtSnapshot() : null;
  return {
    transactions: transactions.map((row) => {
      const value = rowData(row);
      return {
        id: row.$id,
        type: value.type,
        amountMinor: value.amountMinor,
        currency: value.currency || config.currency,
        occurredAt: value.occurredAt,
        merchant: value.merchant,
        category: categoryNames.get(value.categoryId) || value.categoryId || null,
        categoryId: value.categoryId || null,
        ownerScope: value.ownerScope,
        note: value.note || null,
      };
    }),
    categories: categories.map((row) => ({ id: row.$id, ...rowData(row) })),
    budgets: budgets.map((row) => ({ id: row.$id, ...rowData(row), category: categoryNames.get(rowData(row).categoryId) || rowData(row).categoryId || null })),
    goals: goals.map((row) => ({ id: row.$id, ...rowData(row) })),
    ...(debts ? { debts } : {}),
  };
}

async function askGeminiAnalysis(input, snapshot, history, profile) {
  const prompt = [
    'Eres Nia, analista de finanzas personales para un hogar de dos personas.',
    `La fecha y hora actual en ${config.timezone} es: ${localNow()}.`,
    `El usuario es ${profile.alias}. Responde en español.`,
    'Analiza exclusivamente los datos proporcionados. Puedes explicar totales, diferencias entre tú, tu pareja y compartido, categorías, presupuestos, metas, tendencias, meses y oportunidades de mejora.',
    'No inventes transacciones, presupuestos, metas ni saldos. Si no hay datos suficientes, dilo claramente y sugiere qué registrar.',
    'Las deudas (préstamos y tarjetas) llegan ya calculadas en `debts`: cita su saldo, próxima cuota, tasa E.A. y monto vencido tal cual, y no calcules saldos, cuotas, intereses ni plazos de deudas. Si `debts` no está, no hables de deudas.',
    'Devuelve únicamente JSON válido con esta forma: {"reply":"respuesta clara en texto"}.',
    history?.length ? `Contexto reciente:\n${conversationContext(history)}` : 'Sin contexto anterior.',
    `Pregunta actual:\n${input}`,
    `Datos actuales del hogar:\n${JSON.stringify(snapshot)}`,
  ].join('\n\n');
  return geminiJson([{ text: prompt }], 0.3);
}

function normaliseExtraction(raw, profile, previous) {
  const value = raw?.transaction || raw || {};
  const missing = new Set(Array.isArray(value.missingFields) ? value.missingFields : []);
  const amountMinor = Number.isInteger(value.amountMinor) ? value.amountMinor : null;
  const occurredAt = value.occurredAt && !Number.isNaN(new Date(value.occurredAt).getTime()) ? new Date(value.occurredAt).toISOString() : null;
  const merchant = String(value.merchant || '').trim() || null;
  const category = String(value.category || '').trim() || null;
  const ownerScope = ['you', 'partner', 'shared'].includes(value.ownerScope) ? value.ownerScope : (previous?.ownerScope || profile.ownerScope);
  const type = ['expense', 'income', 'transfer'].includes(value.type) ? value.type : 'expense';
  if (!amountMinor || amountMinor <= 0) missing.add('amount');
  if (!occurredAt) missing.add('date');
  if (!merchant) missing.add('merchant');
  if (!category) missing.add('category');
  if (!ownerScope) missing.add('owner');
  return {
    type,
    amountMinor,
    currency: String(value.currency || config.currency).toUpperCase(),
    occurredAt,
    merchant,
    category,
    ownerScope,
    note: String(value.note || '').trim().slice(0, 1000),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
    missingFields: [...missing].filter(Boolean),
  };
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function normaliseOperation(raw, profile) {
  const intent = raw?.intent;
  const action = ['create', 'update', 'delete', 'contribute', 'list'].includes(raw?.action) ? raw.action : 'create';
  const resource = raw?.resource || ({ budget: 'budget', goal: 'goal', category: 'category' })[intent] || (['update', 'delete'].includes(action) && intent === 'transaction' ? 'transaction' : null);
  if (!resource) return null;
  const value = raw?.[resource] && typeof raw[resource] === 'object' ? raw[resource] : {};
  const selector = raw?.selector && typeof raw.selector === 'object' ? raw.selector : {};
  if (resource === 'budget') {
    return {
      kind: 'operation', resource, action,
      data: {
        month: /^\d{4}-\d{2}$/.test(value.month) ? value.month : currentMonth(),
        category: String(value.category || '').trim() || null,
        categoryId: String(value.categoryId || '').trim() || null,
        plannedMinor: Number.isInteger(value.plannedMinor) ? value.plannedMinor : null,
        alertAtPercent: Number.isInteger(value.alertAtPercent) ? value.alertAtPercent : 80,
      },
      selector,
    };
  }
  if (resource === 'goal') {
    return {
      kind: 'operation', resource, action,
      data: {
        name: String(value.name || '').trim() || null,
        targetMinor: Number.isInteger(value.targetMinor) ? value.targetMinor : null,
        currentMinor: Number.isInteger(value.currentMinor) ? value.currentMinor : null,
        contributionMinor: Number.isInteger(value.contributionMinor) ? value.contributionMinor : null,
        targetDate: /^\d{4}-\d{2}-\d{2}$/.test(value.targetDate) ? value.targetDate : null,
        ownerScope: ['you', 'partner', 'shared'].includes(value.ownerScope) ? value.ownerScope : null,
        status: ['active', 'completed', 'paused'].includes(value.status) ? value.status : null,
      },
      selector,
    };
  }
  if (resource === 'category') {
    return {
      kind: 'operation', resource, action,
      data: {
        name: String(value.name || '').trim() || null,
        kind: ['need', 'want', 'saving', 'income'].includes(value.kind) ? value.kind : 'need',
        color: String(value.color || '#73f0b5').trim(),
        icon: String(value.icon || 'tag').trim(),
      },
      selector,
    };
  }
  return {
    kind: 'operation', resource, action,
    data: value,
    selector,
  };
}

function sameText(left, right) {
  return String(left || '').trim().toLocaleLowerCase('es-CO') === String(right || '').trim().toLocaleLowerCase('es-CO');
}

function findCategory(snapshot, nameOrId) {
  if (!nameOrId) return null;
  const value = String(nameOrId).trim();
  return snapshot.categories.find((item) => item.id === value) || snapshot.categories.find((item) => sameText(item.name, value)) || null;
}

function findGoal(snapshot, operation) {
  const selector = operation.selector || {};
  const requested = selector.id || selector.name || operation.data.name;
  if (requested) {
    return snapshot.goals.find((item) => item.id === requested) || snapshot.goals.find((item) => sameText(item.name, requested)) || null;
  }
  const active = snapshot.goals.filter((item) => item.status !== 'completed');
  return active.length === 1 ? active[0] : null;
}

function findTransaction(snapshot, operation) {
  const selector = operation.selector || {};
  if (selector.id) return snapshot.transactions.find((item) => item.id === selector.id) || null;
  if (selector.position === 'latest' || selector.position === 'oldest') {
    const sorted = [...snapshot.transactions].sort((left, right) => new Date(left.occurredAt || 0) - new Date(right.occurredAt || 0));
    return selector.position === 'latest' ? sorted.at(-1) || null : sorted[0] || null;
  }
  const merchant = selector.merchant || operation.data.merchant;
  const targetDate = selector.date || dateOnly(operation.data.occurredAt);
  const amount = Number.isInteger(selector.amountMinor) ? selector.amountMinor : null;
  const candidates = snapshot.transactions
    .map((item) => {
      let score = 0;
      if (merchant && sameText(item.merchant, merchant)) score += 5;
      if (targetDate && dateOnly(item.occurredAt) === targetDate) score += 4;
      if (amount !== null && Number(item.amountMinor) === amount) score += 3;
      if (selector.category && sameText(item.category, selector.category)) score += 2;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  return candidates.length && (candidates.length === 1 || candidates[0].score > candidates[1].score) ? candidates[0].item : null;
}

async function resolveOperation(operation, snapshot, profile) {
  if (!operation) return null;
  const resolved = { ...operation, data: { ...operation.data }, missingFields: [], target: null };
  if (operation.action === 'list') return resolved;
  if (operation.resource === 'budget') {
    const category = findCategory(snapshot, operation.data.categoryId || operation.data.category);
    if (!category) resolved.missingFields.push(operation.data.category || operation.data.categoryId ? 'categoryNotFound' : 'category');
    else resolved.data.categoryId = category.id;
    if (['create', 'update'].includes(operation.action) && (!Number.isInteger(operation.data.plannedMinor) || operation.data.plannedMinor <= 0)) resolved.missingFields.push('plannedMinor');
    const existing = category ? snapshot.budgets.find((item) => item.month === operation.data.month && item.categoryId === category.id) : null;
    resolved.target = existing;
    if (operation.action === 'delete' && !existing) resolved.missingFields.push('budgetNotFound');
    if (operation.action === 'update' && !existing) resolved.action = 'create';
    return resolved;
  }
  if (operation.resource === 'goal') {
    if (operation.action === 'create') {
      if (!operation.data.name) resolved.missingFields.push('name');
      if (!Number.isInteger(operation.data.targetMinor) || operation.data.targetMinor <= 0) resolved.missingFields.push('targetMinor');
      resolved.data.currentMinor = 0;
      resolved.data.ownerScope = operation.data.ownerScope || profile.ownerScope;
      resolved.data.status = operation.data.status || 'active';
      return resolved;
    }
    const target = findGoal(snapshot, operation);
    resolved.target = target;
    if (!target) resolved.missingFields.push('goalNotFound');
    if (target && !resolved.data.ownerScope) resolved.data.ownerScope = target.ownerScope || profile.ownerScope;
    if (operation.action === 'contribute' && (!Number.isInteger(operation.data.contributionMinor) || operation.data.contributionMinor <= 0)) resolved.missingFields.push('contributionMinor');
    if (target && operation.action === 'contribute') resolved.data.currentMinor = Number(target.currentMinor || 0) + operation.data.contributionMinor;
    if (target && operation.action === 'update' && operation.data.currentMinor === null) resolved.data.currentMinor = Number(target.currentMinor || 0);
    return resolved;
  }
  if (operation.resource === 'category') {
    const requested = operation.data.name || operation.selector.name;
    const target = findCategory(snapshot, operation.selector.id || requested);
    resolved.target = target;
    if (!requested && operation.action !== 'list') resolved.missingFields.push('name');
    if (operation.action === 'delete' && !target) resolved.missingFields.push('categoryNotFound');
    if (operation.action === 'create' && target) resolved.missingFields.push('categoryExists');
    return resolved;
  }
  if (operation.resource === 'transaction') {
    const target = findTransaction(snapshot, operation);
    resolved.target = target;
    if (!target) resolved.missingFields.push('transactionNotFound');
    if (operation.data.category) {
      const category = findCategory(snapshot, operation.data.category);
      if (category) resolved.data.categoryId = category.id;
      else resolved.missingFields.push('categoryNotFound');
    }
    return resolved;
  }
  return resolved;
}

function money(value, currency) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency, maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(value);
}

function dateLabel(value) {
  if (!value) return 'sin fecha';
  return new Intl.DateTimeFormat('es-CO', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ownerLabel(value) {
  return ({ you: 'tú', partner: 'tu pareja', shared: 'compartido' })[value] || value;
}

function pendingSummary(pending) {
  const type = pending.type === 'income' ? 'Ingreso' : pending.type === 'transfer' ? 'Transferencia' : 'Gasto';
  return [
    '🧾 Movimiento pendiente',
    '',
    `Tipo: ${type}`,
    `Monto: ${money(pending.amountMinor, pending.currency)}`,
    `Concepto: ${pending.merchant || 'Sin especificar'}`,
    `Categoría: ${pending.category || 'Sin especificar'}`,
    `Fecha: ${dateLabel(pending.occurredAt)}`,
    `Responsable: ${ownerLabel(pending.ownerScope)}`,
    pending.note ? `Nota: ${pending.note}` : '',
    '',
    '¿Quieres registrarlo así? Usa los botones de abajo.',
  ].filter(Boolean).join('\n');
}

function missingLabel(field) {
  return ({ amount: 'monto', date: 'fecha', merchant: 'concepto o comercio', category: 'categoría', owner: 'responsable', name: 'nombre', targetMinor: 'monto objetivo', contributionMinor: 'aporte', plannedMinor: 'límite o presupuesto', categoryNotFound: 'una categoría existente', categoryExists: 'una categoría nueva (esa ya existe)', budgetNotFound: 'un presupuesto existente', goalNotFound: 'una meta existente', transactionNotFound: 'un movimiento identificable' })[field] || field;
}

function operationTitle(operation) {
  const action = ({ create: 'Crear', update: 'Actualizar', delete: 'Eliminar', contribute: 'Registrar aporte' })[operation.action] || 'Cambiar';
  const resource = ({ budget: 'presupuesto', goal: 'meta', category: 'categoría', transaction: 'movimiento' })[operation.resource] || operation.resource;
  return `${action} ${resource}`;
}

function operationSummary(operation) {
  const lines = [`🛠️ ${operationTitle(operation)}`, ''];
  if (operation.resource === 'budget') {
    lines.push(`Categoría: ${operation.data.category || operation.target?.category || '—'}`);
    lines.push(`Mes: ${operation.data.month}`);
    if (operation.action !== 'delete') {
      lines.push(`Límite: ${money(operation.data.plannedMinor, config.currency)}`);
      lines.push(`Alerta: ${operation.data.alertAtPercent}%`);
    }
  } else if (operation.resource === 'goal') {
    const goal = operation.target;
    lines.push(`Meta: ${operation.data.name || goal?.name || '—'}`);
    if (operation.action === 'contribute') lines.push(`Nuevo avance: ${money(operation.data.currentMinor, config.currency)} / ${money(goal?.targetMinor, config.currency)}`);
    else if (operation.action !== 'delete') {
      lines.push(`Objetivo: ${money(operation.data.targetMinor, config.currency)}`);
      lines.push(`Avance: ${money(operation.data.currentMinor || 0, config.currency)}`);
      lines.push(`Responsable: ${ownerLabel(operation.data.ownerScope)}`);
      if (operation.data.targetDate) lines.push(`Fecha objetivo: ${operation.data.targetDate}`);
    }
  } else if (operation.resource === 'category') {
    lines.push(`Categoría: ${operation.data.name || operation.target?.name || '—'}`);
    if (operation.action !== 'delete') lines.push(`Tipo: ${operation.data.kind}`);
  } else if (operation.resource === 'transaction') {
    const item = operation.target;
    lines.push(`Concepto: ${operation.data.merchant || item?.merchant || '—'}`);
    lines.push(`Monto: ${money(operation.data.amountMinor ?? item?.amountMinor, operation.data.currency || item?.currency || config.currency)}`);
    lines.push(`Fecha: ${dateLabel(operation.data.occurredAt || item?.occurredAt)}`);
    lines.push(`Categoría: ${operation.data.category || item?.category || '—'}`);
  }
  lines.push('', operation.action === 'delete' ? '⚠️ Esta acción no se puede deshacer.' : '¿Quieres aplicar este cambio?');
  return lines.join('\n');
}

function listReply(resource, snapshot) {
  if (resource === 'budget') {
    if (!snapshot.budgets.length) return '📊 No hay presupuestos guardados todavía.';
    return ['📊 Presupuestos', '', ...snapshot.budgets.slice(0, 15).map((item) => `• ${item.category || 'Sin categoría'} · ${item.month} · ${money(item.plannedMinor, config.currency)} · alerta ${item.alertAtPercent || 80}%`)].join('\n');
  }
  if (resource === 'goal') {
    if (!snapshot.goals.length) return '🎯 No hay metas guardadas todavía.';
    return ['🎯 Metas', '', ...snapshot.goals.slice(0, 15).map((item) => `• ${item.name} · ${money(item.currentMinor || 0, config.currency)} / ${money(item.targetMinor, config.currency)} · ${item.status || 'active'}`)].join('\n');
  }
  if (resource === 'category') {
    if (!snapshot.categories.length) return '🏷️ No hay categorías guardadas todavía.';
    return ['🏷️ Categorías', '', ...snapshot.categories.filter((item) => !item.archived).slice(0, 30).map((item) => `• ${item.name} · ${item.kind}`)].join('\n');
  }
  if (resource === 'transaction') {
    if (!snapshot.transactions.length) return '🧾 No hay movimientos guardados todavía.';
    return ['🧾 Últimos movimientos', '', ...snapshot.transactions.slice(0, 15).map((item) => `• ${dateOnly(item.occurredAt) || 'sin fecha'} · ${item.merchant || 'Sin concepto'} · ${money(item.amountMinor, item.currency || config.currency)} · ${ownerLabel(item.ownerScope)}`)].join('\n');
  }
  return 'No encontré información para mostrar.';
}

async function ensureCategory(categoryName, type) {
  if (!categoryName) return null;
  const rows = await listRows(TABLES.categories, [
    queryEqual('householdId', config.householdId),
    queryEqual('name', categoryName),
    queryLimit(1),
  ]);
  if (rows[0]) return rows[0].$id;
  const row = await createRow(TABLES.categories, {
    householdId: config.householdId,
    name: categoryName.slice(0, 80),
    kind: type === 'income' ? 'income' : 'need',
    color: '#73f0b5',
    icon: 'tag',
    archived: false,
  }, [permission('read', `team:${config.teamId}`), permission('update', `team:${config.teamId}`)]);
  return row.$id;
}

async function uploadAttachment(attachment, transactionId) {
  const form = new FormData();
  form.append('fileId', randomId());
  form.append('file', new Blob([attachment.bytes], { type: attachment.mimeType }), attachment.name);
  const file = await appwriteRequest(`/storage/buckets/${config.bucketId}/files`, { method: 'POST', body: form });
  await createRow(TABLES.attachments, {
    householdId: config.householdId,
    transactionId,
    fileId: file.$id,
    mimeType: attachment.mimeType,
    originalName: attachment.name.slice(0, 255),
  }, [permission('read', `team:${config.teamId}`)]);
  return file.$id;
}

const teamWritePermissions = () => [permission('read', `team:${config.teamId}`), permission('update', `team:${config.teamId}`)];

async function confirmOperation(chatId, actorId, operation) {
  if (operation.missingFields?.length) {
    await sendMessage(chatId, `Para completar esta acción necesito: ${operation.missingFields.map(missingLabel).join(', ')}.`);
    return;
  }

  if (operation.resource === 'budget') {
    if (operation.action === 'delete') await deleteRow(TABLES.budgets, operation.target.id);
    else await upsertRow(TABLES.budgets, operation.target?.id || randomId(), {
      householdId: config.householdId,
      month: operation.data.month,
      categoryId: operation.data.categoryId,
      plannedMinor: operation.data.plannedMinor,
      alertAtPercent: operation.data.alertAtPercent,
    }, teamWritePermissions());
  } else if (operation.resource === 'goal') {
    if (operation.action === 'delete') await deleteRow(TABLES.goals, operation.target.id);
    else if (operation.target) await updateRow(TABLES.goals, operation.target.id, compactObject({
      name: operation.data.name || undefined,
      targetMinor: operation.data.targetMinor ?? undefined,
      currentMinor: operation.data.currentMinor ?? undefined,
      targetDate: operation.data.targetDate ? new Date(`${operation.data.targetDate}T12:00:00`).toISOString() : undefined,
      ownerScope: operation.data.ownerScope,
      status: operation.data.status || undefined,
    }));
    else await createRow(TABLES.goals, compactObject({
      householdId: config.householdId,
      name: operation.data.name,
      targetMinor: operation.data.targetMinor,
      currentMinor: operation.data.currentMinor || 0,
      targetDate: operation.data.targetDate ? new Date(`${operation.data.targetDate}T12:00:00`).toISOString() : undefined,
      priority: 1,
      ownerScope: operation.data.ownerScope,
      status: operation.data.status || 'active',
    }), teamWritePermissions());
  } else if (operation.resource === 'category') {
    if (operation.action === 'delete') await updateRow(TABLES.categories, operation.target.id, { archived: true });
    else if (operation.target) await updateRow(TABLES.categories, operation.target.id, compactObject({
      name: operation.data.name || undefined,
      kind: operation.data.kind,
      color: operation.data.color,
      icon: operation.data.icon,
      archived: false,
    }));
    else await createRow(TABLES.categories, {
      householdId: config.householdId,
      name: operation.data.name,
      kind: operation.data.kind,
      color: operation.data.color,
      icon: operation.data.icon,
      archived: false,
    }, teamWritePermissions());
  } else if (operation.resource === 'transaction') {
    if (operation.action === 'delete') await deleteRow(TABLES.transactions, operation.target.id);
    else await updateRow(TABLES.transactions, operation.target.id, compactObject({
      merchant: operation.data.merchant,
      amountMinor: Number.isInteger(operation.data.amountMinor) ? operation.data.amountMinor : undefined,
      currency: operation.data.currency,
      occurredAt: operation.data.occurredAt,
      categoryId: operation.data.categoryId,
      ownerScope: operation.data.ownerScope,
      note: operation.data.note,
    }));
  }

  await saveSession(chatId, actorId, 'completed', null);
  await sendMessage(chatId, `✅ Listo. ${operationTitle(operation)} quedó aplicado.`);
}

async function confirmPending(chatId, actorId, profile, updateId) {
  const session = await getSession(chatId);
  const pending = pendingFromSession(session);
  if (pending?.kind === 'debt') {
    // Before the status check: the second tap of a finished debt flow must answer "ya registrado".
    await confirmDebt(debtDeps(), { chatId, actorId, profile, history: historyFromSession(session) }, pending);
    return;
  }
  if (!pending || !['awaiting_confirmation', 'awaiting_clarification'].includes(session.status)) {
    await sendMessage(chatId, 'No tengo un movimiento pendiente para confirmar.');
    return;
  }
  if (pending.kind === 'operation') {
    await confirmOperation(chatId, actorId, pending);
    return;
  }
  if (pending.missingFields?.length) {
    await sendMessage(chatId, `Antes de guardarlo necesito: ${pending.missingFields.map(missingLabel).join(', ')}.`);
    return;
  }
  const categoryId = await ensureCategory(pending.category, pending.type);
  const providerRef = `telegram:${updateId || Date.now()}`;
  const transaction = await createRow(TABLES.transactions, compactObject({
    householdId: config.householdId,
    actorId: profile.appwriteUserId,
    ownerScope: pending.ownerScope,
    type: pending.type,
    amountMinor: pending.amountMinor,
    currency: pending.currency,
    occurredAt: pending.occurredAt,
    merchant: pending.merchant,
    categoryId,
    note: pending.note,
    source: 'telegram',
    confidence: pending.confidence,
    status: 'confirmed',
    providerRef,
    dedupeKey: providerRef,
  }), [
    permission('read', `team:${config.teamId}`),
    ...(profile.appwriteUserId.startsWith('telegram:') ? [] : [permission('update', `user:${profile.appwriteUserId}`), permission('delete', `user:${profile.appwriteUserId}`)]),
  ]);
  let attachmentMessage = '';
  if (pending.attachment) {
    try {
      const messageLike = { document: { file_id: pending.attachment.fileId, file_name: pending.attachment.name, mime_type: pending.attachment.mimeType } };
      await uploadAttachment(await downloadTelegramAttachment(messageLike), transaction.$id);
    } catch (attachmentError) {
      writeError(`No se pudo guardar el recibo: ${attachmentError.message}`);
      attachmentMessage = ' El movimiento se guardó, pero el recibo no pudo adjuntarse.';
    }
  }
  if (pending._eventId) {
    try { await updateRow(TABLES.events, pending._eventId, { status: 'confirmed', transactionId: transaction.$id }); } catch (eventError) { writeError(eventError.message); }
  }
  await saveSession(chatId, actorId, 'completed', null);
  await sendMessage(chatId, `Listo: registré ${pending.type === 'income' ? 'el ingreso' : 'el movimiento'} de ${money(pending.amountMinor, pending.currency)} en ${pending.category}.${attachmentMessage}`);
}

async function cancelPending(chatId, actorId) {
  await saveSession(chatId, actorId, 'cancelled', null);
  await sendMessage(chatId, 'Cancelado. No guardé ningún movimiento.');
}

function intentFor(raw, attachment) {
  if (['analysis', 'conversation', 'transaction', 'budget', 'goal', 'category', 'debt'].includes(raw?.intent)) return raw.intent;
  if (raw?.transaction || attachment) return 'transaction';
  return 'conversation';
}

function conversationReply(raw, profile, input) {
  const asksIdentity = /\b(qui[eé]n soy|sabes qui[eé]n|mi nombre)\b/i.test(input || '');
  if (asksIdentity) {
    return `Sí. En este chat te tengo configurado como ${profile.alias}. Puedo ayudarte a registrar gastos e ingresos, interpretar recibos e imágenes, entender fechas como “ayer”, analizar tus finanzas y las del hogar, y conversar sobre educación financiera. Siempre pediré confirmación antes de guardar un movimiento.`;
  }
  return String(raw?.reply || '').trim() || 'Puedo conversar contigo, interpretar gastos e ingresos, analizar tus finanzas y revisar fotos o documentos de recibos.';
}

async function handleTextOrReceipt(message, updateId, profile) {
  const chatId = chatFromMessage(message);
  const actorId = actorFromMessage(message);
  const text = String(message.text || message.caption || '').trim();
  const session = await getSession(chatId);
  const stored = pendingFromSession(session);
  const previous = stored?.kind === 'debt' && stored.done ? null : stored; // a finished debt flow is not context
  const history = historyFromSession(session);
  const attachment = await downloadTelegramAttachment(message);
  if (!text && !attachment) {
    await sendMessage(chatId, 'Envíame un gasto, ingreso o foto de recibo. Ejemplo: “Ayer gasté 28.500 en mercado”.');
    return;
  }
  const inputHash = createHash('sha256').update(`${config.householdId}:telegram:${updateId || `${actorId}:${text}:${message.date || ''}`}`).digest('hex');
  const raw = await askGemini(text, attachment, previous, history, profile);
  const intent = intentFor(raw, attachment);
  const userContext = text || '[Adjunto una imagen o documento]';

  if (intent === 'debt') {
    await handleDebt(debtDeps(), { chatId, actorId, profile, text, history, previous, sessionStatus: session?.status });
    return;
  }

  // Glossary router: a question that names a debt concept moves from conversation or analysis to the read-only explain flow.
  // A message that reports or requests a write keeps its original action (the router vetoes it), and an attachment never moves.
  if (intent === 'conversation' || intent === 'analysis') {
    const explainHint = glossaryTopic(text, { marker: lastExplain(history), hasAttachment: Boolean(attachment) });
    if (explainHint) {
      await handleDebt(debtDeps(), { chatId, actorId, profile, text, history, previous, sessionStatus: session?.status, explainHint });
      return;
    }
    // A short answer to the questions of a described debt that is waiting is a debt message even if the classifier took it for chat.
    if (!attachment && answersOpenSetup(previous, text)) {
      await handleDebt(debtDeps(), { chatId, actorId, profile, text, history, previous, sessionStatus: session?.status });
      return;
    }
  }

  const operation = normaliseOperation(raw, profile);
  if (operation && (intent !== 'transaction' || ['update', 'delete'].includes(operation.action))) {
    const snapshot = await workspaceSnapshot();
    const resolved = await resolveOperation(operation, snapshot, profile);
    if (resolved.action === 'list') {
      const reply = listReply(resolved.resource, snapshot);
      await saveSession(chatId, actorId, session?.status || 'conversation', previous, appendHistory(appendHistory(history, 'user', userContext), 'assistant', reply));
      await sendMessage(chatId, reply);
      return;
    }
    if (resolved.missingFields.length) {
      const reply = `❓ Para ${operationTitle(resolved).toLowerCase()} necesito: ${resolved.missingFields.map(missingLabel).join(', ')}.`;
      await saveSession(chatId, actorId, session?.status || 'conversation', previous, appendHistory(appendHistory(history, 'user', userContext), 'assistant', reply));
      await sendMessage(chatId, reply);
      return;
    }
    const reply = operationSummary(resolved);
    await saveSession(chatId, actorId, 'awaiting_confirmation', resolved, appendHistory(appendHistory(history, 'user', userContext), 'assistant', reply));
    await sendMessage(chatId, reply, confirmationKeyboard());
    return;
  }

  if (intent === 'conversation') {
    const reply = conversationReply(raw, profile, text);
    await saveSession(chatId, actorId, session?.status || 'conversation', previous, appendHistory(appendHistory(history, 'user', userContext), 'assistant', reply));
    await sendMessage(chatId, reply);
    return;
  }

  if (intent === 'analysis') {
    const snapshot = await workspaceSnapshot({ withDebts: true });
    const analysis = await askGeminiAnalysis(text, snapshot, history, profile);
    const reply = String(analysis?.reply || '').trim() || 'No pude generar el análisis con los datos disponibles.';
    await saveSession(chatId, actorId, session?.status || 'conversation', previous, appendHistory(appendHistory(history, 'user', userContext), 'assistant', reply));
    await sendMessage(chatId, reply);
    return;
  }

  if (await getEvent(inputHash)) return;
  const pending = normaliseExtraction(raw?.transaction || raw, profile, previous);
  pending.attachment = attachment ? { fileId: attachment.fileId, mimeType: attachment.mimeType, name: attachment.name } : previous?.attachment;
  const eventStatus = pending.missingFields.length ? 'needs_clarification' : 'awaiting_confirmation';
  const event = await recordEvent(pending, profile.appwriteUserId, inputHash, eventStatus);
  pending._eventId = event.$id;
  const reply = pending.missingFields.length
    ? `${pendingSummary(pending)}\n\nPara completar el registro necesito: ${pending.missingFields.map(missingLabel).join(', ')}. Respóndeme con esos datos.`
    : pendingSummary(pending);
  await saveSession(
    chatId,
    actorId,
    eventStatus === 'needs_clarification' ? 'awaiting_clarification' : 'awaiting_confirmation',
    pending,
    appendHistory(appendHistory(history, 'user', userContext), 'assistant', reply),
  );
  if (pending.missingFields.length) {
    await sendMessage(chatId, reply);
  } else {
    await sendMessage(chatId, reply, confirmationKeyboard());
  }
}

async function handleCommand(message, command, argument, profile, updateId) {
  const chatId = chatFromMessage(message);
  const actorId = actorFromMessage(message);
  if (command === 'start' || command === 'help' || command === 'ayuda') {
    const reply = `👋 Soy Nia y te tengo configurado como ${profile.alias}.\n\nPuedo conversar, interpretar texto, fotos, PDF y notas de voz; registrar gastos, ingresos y transferencias; crear presupuestos y límites; crear y actualizar metas; administrar categorías; consultar movimientos y analizar las finanzas individuales y del hogar.\n\nSiempre te mostraré una vista previa y pediré confirmación antes de cambiar datos.\n\nComandos: /cancelar · /confirmar · /editar corrección.`;
    const session = await getSession(chatId);
    const history = historyFromSession(session);
    await saveSession(chatId, actorId, session?.status || 'conversation', pendingFromSession(session), appendHistory(appendHistory(history, 'user', `/${command}`), 'assistant', reply));
    await sendMessage(chatId, reply);
    return;
  }
  if (command === 'cancelar') { await cancelPending(chatId, actorId); return; }
  if (command === 'confirmar') { await confirmPending(chatId, actorId, profile, updateId); return; }
  if (command === 'editar') {
    if (!argument) { await sendMessage(chatId, 'Escribe la corrección, por ejemplo: /editar fue el lunes y lo pagó mi pareja.'); return; }
    await handleTextOrReceipt({ ...message, text: argument, photo: undefined, document: undefined }, updateId, profile);
    return;
  }
  await sendMessage(chatId, 'No reconozco ese comando. Usa /ayuda.');
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query;
    await telegramRequest('answerCallbackQuery', { callback_query_id: callback.id });
    const message = callback.message;
    const profile = profileFor(callback.from?.id);
    if (!profile) return;
    const chatId = chatFromMessage(message);
    const actorId = String(callback.from.id);
    if (callback.data === 'nia:confirm') await confirmPending(chatId, actorId, profile, update.update_id);
    else if (callback.data === 'nia:cancel') await cancelPending(chatId, actorId);
    else if (/^nia:exp:/.test(callback.data || '')) {
      // Stateless and read-only: routed before the stage check, so it needs no pending and leaves the waiting one as it is.
      const session = await getSession(chatId);
      await handleExplainCallback(debtDeps(), { chatId, actorId, profile, history: historyFromSession(session), previous: pendingFromSession(session), sessionStatus: session?.status }, callback.data);
    } else if (/^nia:(pick:|strat:|conv:|mode:|chg:|min:|simpay$)/.test(callback.data || '')) {
      const session = await getSession(chatId);
      await handleDebtCallback(debtDeps(), { chatId, actorId, profile, history: historyFromSession(session), pending: pendingFromSession(session) }, callback.data);
    } else if (callback.data === 'nia:edit') await sendMessage(chatId, 'Escribe la corrección, por ejemplo: “fue el lunes y era de transporte”.');
    return;
  }
  const message = update.message;
  if (!message) return;
  const actorId = actorFromMessage(message);
  const chatId = chatFromMessage(message);
  const profile = profileFor(actorId);
  if (!profile) {
    await sendMessage(chatId, `Este bot no está autorizado para tu usuario. Tu Telegram user ID es ${actorId}; compártelo con el administrador para configurarlo.`);
    return;
  }
  const commandMatch = String(message.text || '').match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]+))?$/u);
  if (commandMatch) {
    await handleCommand(message, commandMatch[1].toLowerCase(), commandMatch[2]?.trim(), profile, update.update_id);
    return;
  }
  await handleTextOrReceipt(message, update.update_id, profile);
}

export default async ({ req, res, log, error }) => {
  writeLog = typeof log === 'function' ? log : () => {};
  writeError = typeof error === 'function' ? error : writeLog;
  let update = {};
  try {
    if (req?.method && req.method !== 'POST') return res.json({ ok: true, service: 'nia' });
    if (getHeader(req, 'X-Telegram-Bot-Api-Secret-Token') !== config.telegramSecret) return res.json({ ok: false });
    assertConfig();
    update = parseRequestBody(req);
    await handleUpdate(update);
    return res.json({ ok: true });
  } catch (caught) {
    const reference = errorReference(update);
    writeError(`Nia failure ${reference}: ${caught?.stack || caught?.message || String(caught)}`);
    await notifyFailure(update, caught, reference);
    return res.json({ ok: false, errorReference: `NIA-${reference}` });
  }
};
