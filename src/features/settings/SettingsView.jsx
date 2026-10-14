import { PageHeader } from '../../shared/ui/PageHeader';
import LegalRatesPanel from './LegalRatesPanel';

/**
 * Ajustes page. `legalRates` is the `useLegalRates` result; a saved row is announced through `onNotify`
 * once the tables were reloaded.
 */
export default function SettingsView({ legalRates, onNotify }) {
  const { status, legal, saveState, save, reload } = legalRates;

  const saveRow = async (row) => {
    const saved = await save(row);
    if (saved) onNotify?.(row.kind === 'smmlv' ? 'Salario mínimo guardado.' : 'Tasa guardada.');
    return saved;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ajustes" subtitle="Tasas legales y valores de referencia del hogar." />
      <LegalRatesPanel status={status} legal={legal} saveState={saveState} onSave={saveRow} onReload={reload} />
    </div>
  );
}
