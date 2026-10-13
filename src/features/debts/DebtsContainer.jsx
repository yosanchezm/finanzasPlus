import { dateInputValue } from '../../shared/lib/dates';
import DebtsView from './DebtsView';
import { buildDebtList } from './debtViewModel';
import { useDebtData } from './useDebtData';

/** Data container for the Deudas section: loads, projects and passes plain props to the views. */
export default function DebtsContainer({ inScope, currentOwnerScope, scopeControl }) {
  const data = useDebtData();
  const list = data.status === 'ready'
    ? buildDebtList({ debts: data.debts, events: data.events, asOf: dateInputValue(), inScope })
    : { items: [], totals: undefined };

  return (
    <DebtsView
      status={data.status}
      items={list.items}
      totals={list.totals}
      currentOwnerScope={currentOwnerScope}
      scopeControl={scopeControl}
      onRetry={data.retry}
    />
  );
}
