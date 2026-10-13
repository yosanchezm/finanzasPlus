import { Account, Client, ID, Permission, Query, Role, Storage, TablesDB } from 'appwrite';

const env = import.meta.env;

export const appwriteConfig = {
  endpoint: String(env.VITE_APPWRITE_ENDPOINT || '').replace(/\/$/, ''),
  projectId: String(env.VITE_APPWRITE_PROJECT_ID || ''),
  databaseId: String(env.VITE_APPWRITE_DATABASE_ID || ''),
  householdId: String(env.VITE_APPWRITE_HOUSEHOLD_ID || ''),
  teamId: String(env.VITE_APPWRITE_HOUSEHOLD_TEAM_ID || ''),
  currency: String(env.VITE_APPWRITE_CURRENCY || 'COP').toUpperCase(),
};

export const missingAppwriteConfig = Object.entries({
  VITE_APPWRITE_ENDPOINT: appwriteConfig.endpoint,
  VITE_APPWRITE_PROJECT_ID: appwriteConfig.projectId,
  VITE_APPWRITE_DATABASE_ID: appwriteConfig.databaseId,
  VITE_APPWRITE_HOUSEHOLD_ID: appwriteConfig.householdId,
  VITE_APPWRITE_HOUSEHOLD_TEAM_ID: appwriteConfig.teamId,
}).filter(([, value]) => !value).map(([key]) => key);

const client = new Client();
if (appwriteConfig.endpoint && appwriteConfig.projectId) {
  client.setEndpoint(appwriteConfig.endpoint).setProject(appwriteConfig.projectId);
}

export const account = new Account(client);
export const tablesDB = new TablesDB(client);
export const storage = new Storage(client);

export const TABLES = {
  households: 'households',
  members: 'household_members',
  categories: 'categories',
  transactions: 'transactions',
  budgets: 'budgets',
  goals: 'goals',
  attachments: 'attachments',
  debts: 'debts',
  debtEvents: 'debt_events',
};

const teamRole = Role.team(appwriteConfig.teamId);
const userRole = (userId) => Role.user(userId);

export const permissions = {
  readTeam: Permission.read(teamRole),
  createTeam: Permission.create(teamRole),
  updateTeam: Permission.update(teamRole),
  deleteTeam: Permission.delete(teamRole),
  transactionRow: (userId) => [
    Permission.read(teamRole),
    Permission.update(userRole(userId)),
    Permission.delete(userRole(userId)),
  ],
  attachmentRow: () => [Permission.read(teamRole)],
  // Debts are archived, never deleted.
  debtRow: () => [Permission.read(teamRole), Permission.update(teamRole)],
  // Debt events are append-only: no update, no delete.
  debtEventRow: () => [Permission.read(teamRole)],
  // Cost rows are deleted when their payment is voided (AD7), by either member.
  costRow: () => [Permission.read(teamRole), Permission.update(teamRole), Permission.delete(teamRole)],
};

function assertConfig() {
  if (missingAppwriteConfig.length) {
    throw new Error(`Faltan variables públicas de Appwrite: ${missingAppwriteConfig.join(', ')}`);
  }
}

export const PAGE_SIZE = 100;

/**
 * Every row of the household in `tableId`, following Query.cursorAfter page by page
 * (PAGE_SIZE rows each) until a short page signals the end.
 */
export async function listAllRows(tableId, extraQueries = []) {
  assertConfig();
  const rows = [];
  let cursor = null;
  for (;;) {
    const response = await tablesDB.listRows({
      databaseId: appwriteConfig.databaseId,
      tableId,
      queries: [
        Query.equal('householdId', appwriteConfig.householdId),
        ...extraQueries,
        Query.limit(PAGE_SIZE),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ],
      total: false,
    });
    const page = response.rows || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    cursor = page[page.length - 1].$id;
  }
}

/**
 * Transactions with start <= occurredAt < end, newest first. Backed by the
 * by_household_date index (householdId ASC, occurredAt DESC).
 */
export async function getTransactionsInRange(start, end) {
  return listAllRows(TABLES.transactions, [
    Query.greaterThanEqual('occurredAt', start),
    Query.lessThan('occurredAt', end),
    Query.orderDesc('occurredAt'),
  ]);
}

export async function getCurrentUser() {
  assertConfig();
  try {
    return await account.get();
  } catch (error) {
    if (error?.code === 401 || error?.type === 'general_unauthorized_scope') return null;
    throw error;
  }
}

export async function signIn(email, password) {
  assertConfig();
  await account.createEmailPasswordSession({ email, password });
  return account.get();
}

export async function createAccount({ name, email, password }) {
  assertConfig();
  await account.create({ userId: ID.unique(), email, password, name });
  await account.createEmailPasswordSession({ email, password });
  return account.get();
}

export async function signOut() {
  if (!appwriteConfig.endpoint) return;
  await account.deleteSession({ sessionId: 'current' });
}

/**
 * Household data that is not month-scoped. Transactions are loaded per period
 * with getTransactionsInRange.
 */
export async function getWorkspace() {
  assertConfig();
  const [household, members, categories, budgets, goals] = await Promise.all([
    tablesDB.getRow({ databaseId: appwriteConfig.databaseId, tableId: TABLES.households, rowId: appwriteConfig.householdId }),
    listAllRows(TABLES.members),
    listAllRows(TABLES.categories, [Query.orderAsc('name')]),
    listAllRows(TABLES.budgets, [Query.orderDesc('month')]),
    listAllRows(TABLES.goals),
  ]);

  let workspaceCategories = categories;
  if (!workspaceCategories.length) workspaceCategories = await createDefaultCategories();
  return { household, members, categories: workspaceCategories, budgets, goals };
}

// Seed colors come from the UI palette (src/shared/lib/categories.js CATEGORY_PALETTE).
async function createDefaultCategories() {
  const defaults = [
    ['Hogar', 'need', '#1F4E8C', 'home'],
    ['Alimentación', 'need', '#C99A2E', 'receipt'],
    ['Transporte', 'need', '#0B6E4F', 'transport'],
    ['Ocio', 'want', '#E8875A', 'sparkles'],
    ['Servicios', 'need', '#7A5AF8', 'file'],
    ['Ahorro', 'saving', '#A7B0AB', 'target'],
    ['Ingresos', 'income', '#0B6E4F', 'wallet'],
  ];
  const rows = [];
  for (const [name, kind, color, icon] of defaults) {
    rows.push(await tablesDB.createRow({
      databaseId: appwriteConfig.databaseId,
      tableId: TABLES.categories,
      rowId: ID.unique(),
      data: { householdId: appwriteConfig.householdId, name, kind, color, icon, archived: false },
      permissions: [permissions.readTeam, permissions.updateTeam],
    }));
  }
  return rows;
}

export async function createTransaction(userId, data) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.transactions,
    rowId: ID.unique(),
    data,
    permissions: permissions.transactionRow(userId),
  });
}

export async function updateTransaction(rowId, data) {
  assertConfig();
  return tablesDB.updateRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.transactions,
    rowId,
    data,
  });
}

export async function deleteTransaction(rowId) {
  assertConfig();
  return tablesDB.deleteRow({ databaseId: appwriteConfig.databaseId, tableId: TABLES.transactions, rowId });
}

const receiptsBucketId = () => String(env.VITE_APPWRITE_RECEIPTS_BUCKET_ID || 'receipts');

/**
 * Receipts attached to a transaction (attachments table, by_transaction index), each with
 * the Storage URLs to open it (`viewUrl`) and an image thumbnail (`previewUrl`).
 * The URLs rely on the Appwrite session cookie, so the UI must handle them failing to load.
 */
export async function listAttachments(transactionId) {
  const rows = await listAllRows(TABLES.attachments, [Query.equal('transactionId', transactionId)]);
  const bucketId = receiptsBucketId();
  return rows.map((row) => ({
    ...row,
    viewUrl: storage.getFileView({ bucketId, fileId: row.fileId }),
    previewUrl: storage.getFilePreview({ bucketId, fileId: row.fileId, width: 640, height: 640 }),
  }));
}

export async function createReceipt(file, userId, transactionId) {
  assertConfig();
  const uploaded = await storage.createFile({
    bucketId: receiptsBucketId(),
    fileId: ID.unique(),
    file,
    permissions: permissions.transactionRow(userId),
  });
  await tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.attachments,
    rowId: ID.unique(),
    data: {
      householdId: appwriteConfig.householdId,
      transactionId,
      fileId: uploaded.$id,
      mimeType: file.type || 'application/octet-stream',
      originalName: file.name,
    },
    permissions: permissions.attachmentRow(),
  });
  return uploaded;
}

export async function upsertBudget(rowId, data) {
  assertConfig();
  return tablesDB.upsertRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.budgets,
    rowId: rowId || ID.unique(),
    data,
    permissions: rowId ? undefined : [permissions.readTeam, permissions.updateTeam],
  });
}

export async function createGoal(data) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.goals,
    rowId: ID.unique(),
    data,
    permissions: [permissions.readTeam, permissions.updateTeam],
  });
}

export async function updateGoal(rowId, data) {
  assertConfig();
  return tablesDB.updateRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.goals,
    rowId,
    data,
  });
}

/**
 * Same row permissions as the seeded categories (team read + update).
 * Columns per scripts/migrate-appwrite.mjs: householdId, name, kind and color are required; icon is optional.
 */
export async function createCategory({ name, kind, color, icon }) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.categories,
    rowId: ID.unique(),
    data: {
      householdId: appwriteConfig.householdId,
      name,
      kind,
      color,
      ...(icon ? { icon } : {}),
      archived: false,
    },
    permissions: [permissions.readTeam, permissions.updateTeam],
  });
}

// ---------------------------------------------------------------------------
// Debt management. These functions are the `port` that commitPlan
// (packages/finance-core/src/ledger/commit.js) writes through. Errors keep the
// SDK's HTTP status in `code`: 409 means "already exists", 404 "missing".
// Note: TablesDB.createTransaction (the Appwrite Transactions API) is unrelated
// to createTransaction above, which creates finance transaction rows.
// ---------------------------------------------------------------------------

const hasStatus = (error, status) => error?.code === status || error?.status === status;

export async function listDebts() {
  return listAllRows(TABLES.debts);
}

/** Every event of the household, or only those of `debtId`. Callers sort (project() does). */
export async function listDebtEvents(debtId) {
  return listAllRows(TABLES.debtEvents, debtId ? [Query.equal('debtId', debtId)] : []);
}

/** @param {{ id?: string, data: object }} debt `id` is deterministic for web and Nia (`db{nonce}`). */
export async function createDebt({ id, data }) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.debts,
    rowId: id || ID.unique(),
    data,
    permissions: permissions.debtRow(),
  });
}

/** Rejects with a 409 when `data.dedupeKey` (unique index) or the id already exists. */
export async function createDebtEvent({ id, data }) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.debtEvents,
    rowId: id || ID.unique(),
    data,
    permissions: permissions.debtEventRow(),
  });
}

export async function findDebtEventByDedupe(dedupeKey) {
  assertConfig();
  const response = await tablesDB.listRows({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.debtEvents,
    queries: [Query.equal('householdId', appwriteConfig.householdId), Query.equal('dedupeKey', dedupeKey), Query.limit(1)],
    total: false,
  });
  return response.rows?.[0] ?? null;
}

/** Expense row that carries only the cost of a payment. `id` is `dc{eventId}`; a 409 means it already exists. */
export async function createCostRow({ id, data }) {
  assertConfig();
  return tablesDB.createRow({
    databaseId: appwriteConfig.databaseId,
    tableId: TABLES.transactions,
    rowId: id,
    data,
    permissions: permissions.costRow(),
  });
}

export async function updateCostRow(rowId, data) {
  return updateTransaction(rowId, data);
}

/** A row that is already gone (404) counts as deleted. */
export async function deleteCostRow(rowId) {
  try {
    await deleteTransaction(rowId);
  } catch (error) {
    if (!hasStatus(error, 404)) throw error;
  }
}

export async function listCostRows(debtId) {
  return listAllRows(TABLES.transactions, [Query.equal('debtId', debtId)]);
}

const COST_CATEGORY = { name: 'Costos financieros', kind: 'need', color: '#7A5AF8', icon: 'receipt' };
const foldName = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

async function findCostCategory() {
  const categories = await listAllRows(TABLES.categories);
  return categories.find((category) => foldName(category.name) === foldName(COST_CATEGORY.name)) ?? null;
}

/**
 * Id of the "Costos financieros" category: found by folded name, else created
 * with the deterministic id `cf{householdId}` (cut to Appwrite's 36 characters).
 * If a concurrent client creates it first (409), the category is read back.
 */
export async function ensureCostCategory(householdId = appwriteConfig.householdId) {
  assertConfig();
  const existing = await findCostCategory();
  if (existing) return existing.$id;
  try {
    const created = await tablesDB.createRow({
      databaseId: appwriteConfig.databaseId,
      tableId: TABLES.categories,
      rowId: `cf${householdId}`.slice(0, 36),
      data: { householdId, ...COST_CATEGORY, archived: false },
      permissions: [permissions.readTeam, permissions.updateTeam],
    });
    return created.$id;
  } catch (error) {
    if (!hasStatus(error, 409)) throw error;
    const raced = await findCostCategory();
    if (!raced) throw error;
    return raced.$id;
  }
}

/** The port `commitPlan(port, plan)` needs (see commit.js). */
export function debtPort() {
  return {
    ensureCostCategory,
    createEvent: createDebtEvent,
    findEventByDedupe: findDebtEventByDedupe,
    createCostRow,
    deleteCostRow,
  };
}
