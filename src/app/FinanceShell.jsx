import { lazy, Suspense, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { activeCategories } from '@finance-core';
import {
  appwriteConfig,
  createCategory,
  createGoal,
  createReceipt,
  createTransaction,
  deleteTransaction,
  listAttachments,
  updateGoal,
  updateTransaction,
} from '../appwrite';
import AssistantPanel from '../features/assistant/AssistantPanel';
import { buildCashflowSeries } from '../features/dashboard/cashflow';
import DashboardView from '../features/dashboard/DashboardView';
import { ScopeControl } from '../features/dashboard/ScopeControl';
import GoalModal from '../features/goals/GoalModal';
import AppShell from '../features/shell/AppShell';
import TransactionDetail from '../features/transactions/TransactionDetail';
import TransactionModal from '../features/transactions/TransactionModal';
import { categoryColor, iconForCategory } from '../shared/lib/categories';
import { dateInputValue, daysInMonth, monthKey, monthStartDate, monthsEndingAt } from '../shared/lib/dates';
import { readableError } from '../shared/lib/errors';
import { formatLongDate, formatMonth, formatMonthLabel } from '../shared/lib/format';
import { aggregateMonthlyTotals } from '../shared/lib/monthly';
import { Toast } from '../shared/ui/Toast';
import { useFinanceData } from './useFinanceData';
import { buildBudgetMonth, canEditBudget, legacyDashboardProps, resolveBudgetLines } from './budgetMonth';
import { PeriodError, ViewSkeleton } from './ViewSkeleton';

// Sections other than the default one are split into their own chunks.
const TransactionsView = lazy(() => import('../features/transactions/TransactionsView'));
const BudgetContainer = lazy(() => import('../features/budget/BudgetContainer'));
const GoalsView = lazy(() => import('../features/goals/GoalsView'));
const DebtsContainer = lazy(() => import('../features/debts/DebtsContainer'));
const SettingsContainer = lazy(() => import('../features/settings/SettingsContainer'));

const PERIOD_VIEWS = ['Resumen', 'Movimientos', 'Presupuesto'];
// Debts and settings are not month-scoped: the period switcher would suggest otherwise.
const UNSCOPED_VIEWS = ['Deudas', 'Ajustes'];

const resetForm = () => ({
  merchant: '', amount: '', categoryId: '', type: 'expense', owner: 'you', date: dateInputValue(), note: '',
});

const toWorkspaceTransaction = (row, categories) => {
  const category = categories.find((item) => item.$id === row.categoryId);
  return {
    ...row,
    categoryName: category?.name || 'Sin categoría',
    categoryColor: category ? categoryColor(category) : undefined,
    icon: row.type === 'income' ? Wallet : iconForCategory(category),
  };
};

const remainingDaysLabel = (days) => {
  if (days === 0) return 'último día del mes';
  return days === 1 ? 'queda 1 día del mes' : `quedan ${days} días del mes`;
};

/** Data/state container for the signed-in experience. Views below are presentational. */
export default function FinanceShell({ user, initialWorkspace, onLogout }) {
  const today = new Date();
  const currentMonth = monthKey(today);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [activeView, setActiveView] = useState('Resumen');
  const [scope, setScope] = useState('total');
  const [transactionSearch, setTransactionSearch] = useState('');
  const [transactionCategory, setTransactionCategory] = useState('all');
  const [showTransaction, setShowTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [receiptFile, setReceiptFile] = useState(null);
  const [newTransaction, setNewTransaction] = useState(resetForm);
  const [showGoal, setShowGoal] = useState(false);
  const [detailTransaction, setDetailTransaction] = useState(null);

  const data = useFinanceData(initialWorkspace, selectedMonth);
  const { household, members, categories, budgets, goals, budgetLines, debts, debtEvents } = data.workspace;
  // Archived (merged or deleted) categories still name their old movements, but are never offered or charted.
  const pickableCategories = useMemo(() => activeCategories(categories), [categories]);
  const isCurrentMonth = selectedMonth === currentMonth;
  const monthStart = monthStartDate(selectedMonth);
  const monthDays = daysInMonth(monthStart);
  const remainingDays = isCurrentMonth ? Math.max(0, monthDays - today.getDate()) : 0;
  const dayOfMonth = isCurrentMonth ? today.getDate() : monthDays;
  const periodLabel = formatMonth(selectedMonth);

  const currentOwnerScope = user.$id === household?.ownerId ? 'you' : 'partner';
  const partnerOwnerScope = currentOwnerScope === 'you' ? 'partner' : 'you';
  const householdName = household?.name || 'Mi hogar';
  const currentMember = members.find((member) => member.userId === user.$id);
  const displayName = currentMember?.alias || user.name || user.email?.split('@')[0] || 'Tu cuenta';

  const toStoredScope = (uiScope) => uiScope === 'total' ? 'total' : uiScope === 'you' ? currentOwnerScope : partnerOwnerScope;
  const storedScope = toStoredScope(scope);
  const inScope = (item) => storedScope === 'total' || item.ownerScope === storedScope || item.ownerScope === 'shared';

  const periodTransactions = data.periodReady ? data.period.transactions : [];
  const visibleTransactions = useMemo(
    () => periodTransactions.map((row) => toWorkspaceTransaction(row, categories)).filter(inScope),
    [periodTransactions, categories, storedScope],
  );

  const totals = useMemo(() => ({
    income: visibleTransactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amountMinor || 0), 0),
    expenses: visibleTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amountMinor || 0), 0),
  }), [visibleTransactions]);

  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.$id, category])), [categories]);
  const debtEventRows = debtEvents?.status === 'ok' && debts?.status === 'ok' ? debtEvents.rows : null;

  // Previous 5 months (aggregated from their rows) + the selected month, all with the same scope filter.
  const history = useMemo(() => aggregateMonthlyTotals(
    [...(data.periodReady ? data.period.history : []).filter(inScope), ...visibleTransactions],
    monthsEndingAt(selectedMonth, 6),
    { categoriesById, debts: debts?.rows ?? [], debtEvents: debtEventRows, inScope },
  ), [data.period, data.periodReady, visibleTransactions, selectedMonth, storedScope, categoriesById, debts, debtEventRows]);

  // The one budget computation of the month (AD6). Lines come from budget_lines, or from the read-only budgets while migrating.
  const { linesMode, linesStatus, lines } = useMemo(() => resolveBudgetLines({ budgetLines, budgets }), [budgetLines, budgets]);
  const canEdit = canEditBudget({ scope, linesMode, linesStatus });
  const budgetMonth = useMemo(() => buildBudgetMonth({
    month: selectedMonth, lines, categories, transactions: visibleTransactions, history: data.periodReady ? data.period.history : [],
    debts, debtEvents, inScope, scoped: storedScope !== 'total',
  }), [selectedMonth, lines, categories, visibleTransactions, data.period, data.periodReady, debts, debtEvents, storedScope]);
  // Until the dashboard reads budgetMonth directly (S7) it keeps its planned/spent summary and category stats.
  const { budget: dashboardBudget, categoryStats } = useMemo(() => legacyDashboardProps(budgetMonth, pickableCategories), [budgetMonth, pickableCategories]);
  const cashflow = useMemo(
    () => buildCashflowSeries(visibleTransactions, new Date(monthStart.getFullYear(), monthStart.getMonth(), dayOfMonth), { categoriesById }),
    [visibleTransactions, selectedMonth, dayOfMonth, categoriesById],
  );

  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 3000); };
  const refreshInPlace = () => data.refresh().catch((error) => notify(readableError(error)));

  const openCreateTransaction = () => { setEditingTransaction(null); setReceiptFile(null); setNewTransaction({ ...resetForm(), categoryId: pickableCategories[0]?.$id || '' }); setShowTransaction(true); };
  const openEditTransaction = (item) => { setEditingTransaction(item); setReceiptFile(null); setNewTransaction({ merchant: item.merchant || '', amount: String(item.amountMinor || ''), categoryId: item.categoryId || '', type: item.type || 'expense', owner: item.ownerScope === 'shared' ? 'shared' : item.ownerScope === currentOwnerScope ? 'you' : 'partner', date: dateInputValue(new Date(item.occurredAt)), note: item.note || '' }); setShowTransaction(true); };

  const saveTransaction = async (event) => {
    event.preventDefault();
    const amount = Math.round(Number(newTransaction.amount));
    if (!newTransaction.merchant.trim() || !amount || !newTransaction.date) { notify('Completa concepto, monto y fecha.'); return; }
    setSaving(true);
    const storedOwnerScope = toStoredScope(newTransaction.owner);
    const editableData = { type: newTransaction.type, amountMinor: amount, currency: appwriteConfig.currency, occurredAt: new Date(`${newTransaction.date}T12:00:00`).toISOString(), merchant: newTransaction.merchant.trim(), ownerScope: storedOwnerScope, note: newTransaction.note.trim() || undefined, categoryId: newTransaction.categoryId || undefined };
    try {
      let saved;
      if (editingTransaction) saved = await updateTransaction(editingTransaction.$id, editableData);
      else {
        const providerRef = `web:${user.$id}:${Date.now()}`;
        saved = await createTransaction(user.$id, { householdId: household.$id, actorId: user.$id, ...editableData, source: 'web', confidence: 1, status: 'confirmed', providerRef, dedupeKey: providerRef });
        if (receiptFile) await createReceipt(receiptFile, user.$id, saved.$id);
      }
      setShowTransaction(false); setEditingTransaction(null); setReceiptFile(null); setNewTransaction(resetForm());
      await data.refresh();
      const savedMonth = newTransaction.date.slice(0, 7);
      const where = savedMonth === selectedMonth ? '' : ` en ${formatMonth(savedMonth)}`;
      notify(editingTransaction ? `Movimiento actualizado${where}.` : `Movimiento guardado${where}.`);
    } catch (error) { notify(readableError(error)); } finally { setSaving(false); }
  };

  // Confirmation happens in TransactionsView (Radix dialog) before this runs.
  const removeTransaction = async (item) => {
    try { await deleteTransaction(item.$id); await data.refresh(); notify('Movimiento eliminado.'); } catch (error) { notify(readableError(error)); }
  };

  const addCategory = async (category) => {
    try {
      await createCategory(category);
      await data.refresh();
      notify(`Categoría “${category.name}” creada.`);
    } catch (error) {
      notify(readableError(error));
      throw error;
    }
  };

  const saveGoal = async (goal) => {
    if (!goal.name.trim() || !Number(goal.targetMinor)) return;
    try { await createGoal({ householdId: household.$id, name: goal.name.trim(), targetMinor: Math.round(Number(goal.targetMinor)), currentMinor: 0, targetDate: goal.targetDate ? new Date(`${goal.targetDate}T12:00:00`).toISOString() : undefined, priority: 1, ownerScope: toStoredScope(goal.ownerScope), status: 'active' }); setShowGoal(false); await data.refresh(); notify('Meta creada en Appwrite.'); } catch (error) { notify(readableError(error)); }
  };

  /** Overshooting the target is stored as-is; the UI caps the progress display. */
  const contributeToGoal = async (goal, amount) => {
    await updateGoal(goal.$id, { currentMinor: Number(goal.currentMinor || 0) + amount });
    await data.refresh().catch((error) => notify(readableError(error)));
    notify(`Aporte registrado en “${goal.name}”.`);
  };

  const searchTransactions = (query) => {
    setTransactionSearch(query);
    setActiveView('Movimientos');
  };

  const showCategoryTransactions = (categoryId) => {
    setTransactionCategory(categoryId);
    setActiveView('Movimientos');
  };

  const scopeControl = <ScopeControl scope={scope} onScopeChange={setScope} />;
  const needsPeriod = PERIOD_VIEWS.includes(activeView);

  const renderView = () => {
    if (needsPeriod && !data.periodReady) {
      return data.periodError && !data.periodLoading ? <PeriodError onRetry={data.retryPeriod} /> : <ViewSkeleton />;
    }
    switch (activeView) {
      case 'Movimientos':
        return (
          <TransactionsView
            transactions={visibleTransactions}
            categories={pickableCategories}
            month={selectedMonth}
            currentOwnerScope={currentOwnerScope}
            search={transactionSearch}
            onSearchChange={setTransactionSearch}
            categoryFilter={transactionCategory}
            onCategoryFilterChange={setTransactionCategory}
            onAdd={openCreateTransaction}
            onEdit={openEditTransaction}
            onDelete={removeTransaction}
            onOpenDetail={setDetailTransaction}
            scopeControl={scopeControl}
          />
        );
      case 'Presupuesto':
        return (
          <BudgetContainer
            key={selectedMonth}
            allCategories={categories}
            month={selectedMonth}
            isCurrentMonth={isCurrentMonth}
            dayOfMonth={dayOfMonth}
            daysInMonth={monthDays}
            budgetMonth={budgetMonth}
            lines={lines}
            actorId={user.$id}
            canEdit={canEdit}
            linesMode={linesMode}
            scope={scope}
            onRefresh={refreshInPlace}
            onCreateCategory={addCategory}
            scopeControl={scopeControl}
          />
        );
      case 'Metas':
        return <GoalsView goals={goals} currentOwnerScope={currentOwnerScope} onAdd={() => setShowGoal(true)} onContribute={contributeToGoal} />;
      case 'Deudas':
        return (
          <DebtsContainer
            inScope={inScope}
            currentOwnerScope={currentOwnerScope}
            scopeControl={scopeControl}
            householdId={household.$id}
            user={user}
            onRefresh={refreshInPlace}
            onNotify={notify}
            onNavigate={setActiveView}
          />
        );
      case 'Ajustes':
        return <SettingsContainer user={user} onNotify={notify} />;
      default:
        return (
          <DashboardView
            dateLabel={isCurrentMonth ? `${formatLongDate(today)} · ${remainingDaysLabel(remainingDays)}` : `${formatMonthLabel(selectedMonth)} · mes cerrado`}
            periodLabel={periodLabel}
            scope={scope}
            onScopeChange={setScope}
            totals={totals}
            incomeCount={visibleTransactions.filter((item) => item.type === 'income').length}
            expenseCount={visibleTransactions.filter((item) => item.type === 'expense').length}
            budget={dashboardBudget}
            remainingDays={remainingDays}
            isCurrentMonth={isCurrentMonth}
            cashflow={cashflow}
            history={history}
            categoryStats={categoryStats}
            onSelectCategory={showCategoryTransactions}
            onSelectMonth={setSelectedMonth}
            recentTransactions={visibleTransactions}
            goals={goals}
            currentOwnerScope={currentOwnerScope}
            onNavigate={setActiveView}
            onAddTransaction={openCreateTransaction}
            onAddGoal={() => setShowGoal(true)}
            onOpenAssistant={() => setShowAssistant(true)}
            onOpenDetail={setDetailTransaction}
          />
        );
    }
  };

  return (
    <>
      <AppShell
        householdName={householdName}
        members={members}
        displayName={displayName}
        email={user.email}
        activeView={activeView}
        transactionsCount={periodTransactions.length}
        month={selectedMonth}
        maxMonth={currentMonth}
        onMonthChange={setSelectedMonth}
        showPeriod={!UNSCOPED_VIEWS.includes(activeView)}
        onSearch={searchTransactions}
        busy={data.refreshing || data.periodLoading}
        refreshing={data.refreshing}
        onNavigate={setActiveView}
        onAdd={openCreateTransaction}
        onRefresh={refreshInPlace}
        onOpenAssistant={() => setShowAssistant(true)}
        onLogout={onLogout}
      >
        <Suspense fallback={<ViewSkeleton label="Cargando la sección…" />}>{renderView()}</Suspense>
      </AppShell>

      {showTransaction && <TransactionModal form={newTransaction} setForm={setNewTransaction} categories={pickableCategories} receiptFile={receiptFile} setReceiptFile={setReceiptFile} editing={editingTransaction} saving={saving} onClose={() => setShowTransaction(false)} onSubmit={saveTransaction} />}
      {detailTransaction && (
        <TransactionDetail
          transaction={detailTransaction}
          currentOwnerScope={currentOwnerScope}
          currentUserId={user.$id}
          members={members}
          loadAttachments={listAttachments}
          onClose={() => setDetailTransaction(null)}
          onEdit={(item) => { setDetailTransaction(null); openEditTransaction(item); }}
          onDelete={(item) => { setDetailTransaction(null); removeTransaction(item); }}
        />
      )}
      {showGoal && <GoalModal onClose={() => setShowGoal(false)} onSubmit={saveGoal} />}
      {showAssistant && <AssistantPanel onClose={() => setShowAssistant(false)} onNavigate={(view) => { setActiveView(view); setShowAssistant(false); }} totals={totals} transactionsCount={periodTransactions.length} />}
      <Toast message={toast} />
    </>
  );
}
