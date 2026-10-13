/**
 * Idempotent schema migration for Appwrite 1.8.1 TablesDB.
 *
 * It creates only resources that do not exist. It never drops or alters
 * existing tables/columns/indexes, so it is safe to run more than once.
 */

import { withDebtSchema } from './lib/debt-schema.mjs';

const endpoint = (process.env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, '');
const projectId = process.env.VITE_APPWRITE_PROJECT_ID;
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || 'finanzas_plus';
const apiKey = process.env.APPWRITE_API_KEY;
const teamId = process.env.VITE_APPWRITE_HOUSEHOLD_TEAM_ID || process.env.HOUSEHOLD_TEAM_ID;

const required = [
  ['VITE_APPWRITE_ENDPOINT', endpoint],
  ['VITE_APPWRITE_PROJECT_ID', projectId],
  ['APPWRITE_API_KEY', apiKey],
  ['VITE_APPWRITE_HOUSEHOLD_TEAM_ID (o HOUSEHOLD_TEAM_ID)', teamId],
];
const missing = required.filter(([, value]) => !value).map(([name]) => name);
if (missing.length) {
  console.error(`Faltan variables para la migración: ${missing.join(', ')}`);
  console.error('Copia .env.example a .env, completa los valores y vuelve a ejecutar npm run migrate:appwrite.');
  process.exit(1);
}

const team = (action) => `${action}("team:${teamId}")`;

const baseTables = [
  {
    id: 'households', name: 'Hogares', rowSecurity: true,
    permissions: [team('read'), team('create'), team('update')],
    columns: [
      string('name', 120, true), string('currency', 3, true), string('timezone', 64, true), string('ownerId', 36, true),
    ],
    indexes: [index('by_owner', 'key', ['ownerId'])],
  },
  {
    id: 'household_members', name: 'Miembros del hogar', rowSecurity: true,
    permissions: [team('read'), team('create'), team('update')],
    columns: [
      string('householdId', 36, true), string('userId', 36, true), string('alias', 80, true),
      string('role', 24, true), string('color', 20, false),
    ],
    indexes: [index('by_household_user', 'unique', ['householdId', 'userId'])],
  },
  {
    id: 'categories', name: 'Categorías', rowSecurity: true,
    permissions: [team('read'), team('create'), team('update')],
    columns: [
      string('householdId', 36, true), string('name', 80, true), string('kind', 24, true),
      string('color', 20, true), string('icon', 32, false), boolean('archived', false),
    ],
    indexes: [index('by_household_name', 'key', ['householdId', 'name'])],
  },
  {
    id: 'transactions', name: 'Movimientos', rowSecurity: true,
    // The table deliberately grants only create. Every row gets its own
    // read/update/delete permissions based on ownerScope when inserted.
    permissions: [team('create')],
    columns: [
      string('householdId', 36, true), string('actorId', 36, true), string('ownerScope', 16, true),
      string('type', 16, true), integer('amountMinor', true), string('currency', 3, true),
      datetime('occurredAt', true), string('merchant', 160, true), string('categoryId', 36, false),
      string('accountId', 36, false), string('note', 1000, false), string('source', 24, true),
      number('confidence', false), string('status', 24, true), string('providerRef', 160, false),
      string('dedupeKey', 160, false),
    ],
    indexes: [
      index('by_household_date', 'key', ['householdId', 'occurredAt'], ['ASC', 'DESC']),
      index('by_household_scope_date', 'key', ['householdId', 'ownerScope', 'occurredAt'], ['ASC', 'ASC', 'DESC']),
      index('by_household_category_date', 'key', ['householdId', 'categoryId', 'occurredAt'], ['ASC', 'ASC', 'DESC']),
    ],
  },
  {
    id: 'budgets', name: 'Presupuestos', rowSecurity: true,
    permissions: [team('read'), team('create'), team('update')],
    columns: [
      string('householdId', 36, true), string('month', 7, true), string('categoryId', 36, true),
      integer('plannedMinor', true), integer('alertAtPercent', false),
    ],
    indexes: [index('by_household_month', 'key', ['householdId', 'month'])],
  },
  {
    id: 'goals', name: 'Metas', rowSecurity: true,
    permissions: [team('read'), team('create'), team('update')],
    columns: [
      string('householdId', 36, true), string('name', 120, true), integer('targetMinor', true),
      integer('currentMinor', true), datetime('targetDate', false), integer('priority', false),
      string('ownerScope', 16, true), string('status', 24, true),
    ],
    indexes: [index('by_household_status', 'key', ['householdId', 'status'])],
  },
  {
    id: 'attachments', name: 'Adjuntos de movimientos', rowSecurity: true,
    permissions: [team('create')],
    columns: [
      string('householdId', 36, true), string('transactionId', 36, true), string('fileId', 36, true),
      string('mimeType', 80, true), string('originalName', 255, false),
    ],
    indexes: [index('by_transaction', 'key', ['transactionId'])],
  },
  {
    id: 'ai_events', name: 'Eventos de Nia', rowSecurity: true,
    permissions: [team('read'), team('create')],
    columns: [
      string('householdId', 36, true), string('actorId', 36, true), string('channel', 24, true),
      string('inputHash', 128, true), longtext('extractedJson', false), string('missingFields', 1000, false),
      number('confidence', false), string('status', 24, true), string('transactionId', 36, false),
    ],
    indexes: [
      index('by_household_channel', 'key', ['householdId', 'channel']),
      index('by_input_hash', 'unique', ['inputHash']),
    ],
  },
  {
    id: 'bot_sessions', name: 'Sesiones del bot', rowSecurity: true,
    permissions: [team('read'), team('create'), team('update')],
    columns: [
      string('householdId', 36, true), string('channel', 24, true), string('externalChatId', 64, true),
      string('actorId', 36, true), longtext('pendingJson', false), string('status', 32, true),
      datetime('expiresAt', false),
    ],
    indexes: [index('by_household_channel_chat', 'unique', ['householdId', 'channel', 'externalChatId'])],
  },
];

// Debt management (additive): the debts and debt_events tables plus transactions.debtId.
// The ensure* loops below only create what is missing, which keeps reruns a no-op.
const tables = withDebtSchema(baseTables, team);

// Appwrite 1.8.x self-hosted exposes the legacy `string` column endpoint.
// `varchar` is documented for newer API versions but returns 404 on 1.8.1.
function string(key, size, required = false) { return { key, type: 'string', size, required }; }
function number(key, required = false) { return { key, type: 'float', required }; }
function integer(key, required = false) { return { key, type: 'integer', required }; }
function boolean(key, required = false) { return { key, type: 'boolean', required }; }
function datetime(key, required = false) { return { key, type: 'datetime', required }; }
// Appwrite 1.8.x has a per-row schema-size limit. Nia's structured payload
// is intentionally capped below it instead of using an unavailable longtext
// endpoint. The raw receipt remains in Storage, not in this column.
function longtext(key, required = false) { return { key, type: 'string', size: 8000, required }; }
function index(key, type, columns, orders = []) { return { key, type, columns, orders }; }

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${endpoint}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Appwrite-Project': projectId,
      'X-Appwrite-Key': apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  // A GET 404 means a resource is absent and is useful to ensure* helpers.
  // A POST/PUT/PATCH/DELETE 404 is a real migration error and must stop.
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) {
    const message = data.message || data.raw || response.statusText;
    throw new Error(`${method} ${path} → ${response.status}: ${message}`);
  }
  return data;
}

async function ensureDatabase() {
  const existing = await request(`/tablesdb/${databaseId}`);
  if (existing) {
    console.log(`✓ Base de datos existente: ${databaseId}`);
    return;
  }
  await request('/tablesdb', { method: 'POST', body: { databaseId, name: 'Finanzas Plus', enabled: true } });
  console.log(`+ Base de datos creada: ${databaseId}`);
}

async function ensureTable(table) {
  const path = `/tablesdb/${databaseId}/tables/${table.id}`;
  const existing = await request(path);
  if (existing) {
    console.log(`✓ Tabla existente: ${table.id}`);
    return;
  }
  await request(`/tablesdb/${databaseId}/tables`, {
    method: 'POST',
    body: { tableId: table.id, name: table.name, permissions: table.permissions, rowSecurity: table.rowSecurity, enabled: true },
  });
  console.log(`+ Tabla creada: ${table.id}`);
}

async function ensureColumn(table, column) {
  const base = `/tablesdb/${databaseId}/tables/${table.id}`;
  if (await request(`${base}/columns/${encodeURIComponent(column.key)}`)) return;
  const body = { key: column.key, required: column.required, array: false };
  if (column.size) body.size = column.size;
  await request(`${base}/columns/${column.type}`, { method: 'POST', body });
  console.log(`  + Columna ${table.id}.${column.key}`);
  await waitForColumn(base, column.key);
}

async function waitForColumn(base, key) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const column = await request(`${base}/columns/${encodeURIComponent(key)}`);
    if (column && (column.status === 'available' || column.status === undefined)) return;
    if (column?.status === 'failed') throw new Error(`La columna ${key} no pudo crearse.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Tiempo de espera agotado creando la columna ${key}.`);
}

async function ensureIndex(table, definition) {
  const base = `/tablesdb/${databaseId}/tables/${table.id}`;
  if (await request(`${base}/indexes/${encodeURIComponent(definition.key)}`)) return;
  await request(`${base}/indexes`, { method: 'POST', body: definition });
  console.log(`  + Índice ${table.id}.${definition.key}`);
}

async function ensureBucket() {
  const bucketId = 'receipts';
  if (await request(`/storage/buckets/${bucketId}`)) {
    console.log(`✓ Bucket existente: ${bucketId}`);
    return;
  }
  await request('/storage/buckets', {
    method: 'POST',
    body: {
      bucketId,
      name: 'Recibos de Finanzas Plus',
      permissions: [team('read'), team('create'), team('update'), team('delete')],
      fileSecurity: true,
      enabled: true,
      maximumFileSize: 10485760,
      allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
      encryption: true,
      antivirus: true,
    },
  });
  console.log(`+ Bucket creado: ${bucketId}`);
}

try {
  console.log(`\nMigrando Finanzas Plus contra ${endpoint}`);
  await ensureDatabase();
  for (const table of tables) {
    await ensureTable(table);
    for (const column of table.columns) await ensureColumn(table, column);
    for (const definition of table.indexes) await ensureIndex(table, definition);
  }
  await ensureBucket();
  console.log('\nMigración terminada. No se eliminaron recursos existentes.');
} catch (error) {
  console.error(`\nMigración fallida: ${error.message}`);
  process.exit(1);
}
